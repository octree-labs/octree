package internal

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
)

// MaxFilesPerRequest bounds the number of files written per compile; real
// projects are tens of files, and the request body is capped separately.
const MaxFilesPerRequest = 1000

var requestQueue chan *CompileJob

// bindJSON parses the body and maps an oversized body (see
// MaxRequestBodyBytes in main.go) to 413 instead of a generic 400.
func bindJSON(c *gin.Context, dest interface{}) bool {
	err := c.ShouldBindJSON(dest)
	if err == nil {
		return true
	}
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		c.JSON(http.StatusRequestEntityTooLarge, ErrorResponse{
			Error:   "Request too large",
			Message: fmt.Sprintf("Request body exceeds the %d MB limit", tooLarge.Limit>>20),
		})
		return false
	}
	c.JSON(http.StatusBadRequest, ErrorResponse{
		Error:   "Invalid request",
		Message: "Could not parse JSON payload",
	})
	return false
}

// validateFiles rejects requests whose file list could escape the workspace
// or is unreasonably large.
func validateFiles(files []FileEntry) *ErrorResponse {
	if len(files) > MaxFilesPerRequest {
		return &ErrorResponse{
			Error:   "Invalid request",
			Message: fmt.Sprintf("Too many files (%d); the limit is %d", len(files), MaxFilesPerRequest),
		}
	}
	for _, file := range files {
		if err := validateFilePath(file.Path); err != nil {
			return &ErrorResponse{
				Error:   "Invalid request",
				Message: fmt.Sprintf("Invalid file path: %v", err),
			}
		}
	}
	return nil
}

// SetRequestQueue sets the queue for compilation jobs
func SetRequestQueue(queue chan *CompileJob) {
	requestQueue = queue
}

// HealthHandler handles health check requests
func HealthHandler(c *gin.Context) {
	stats, issues := GetSystemStats()

	status := "ok"
	httpStatus := http.StatusOK

	// Degrade status based on issues
	if len(issues) > 0 {
		status = "degraded"
	}

	// Critical issues that should return unhealthy
	if stats.MemoryPercent > 95 || stats.CPUPercent > 99 || len(stats.StuckProcesses) > 0 {
		status = "unhealthy"
		httpStatus = http.StatusServiceUnavailable
	}

	c.JSON(httpStatus, HealthResponse{
		Status:        status,
		QueueLength:   len(requestQueue),
		QueueCapacity: cap(requestQueue),
		Timestamp:     time.Now().Format(time.RFC3339),
		System:        stats,
		Issues:        issues,
	})
}

// CompileHandler handles LaTeX compilation requests
func CompileHandler(c *gin.Context) {
	// Parse request
	var req CompileRequest
	if !bindJSON(c, &req) {
		return
	}

	if len(req.Files) == 0 {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Error:   "Invalid request",
			Message: "The files array must contain at least one file",
		})
		return
	}

	if errResp := validateFiles(req.Files); errResp != nil {
		c.JSON(http.StatusBadRequest, *errResp)
		return
	}

	files := req.Files

	// Log project ID if provided
	if req.ProjectID != "" {
		fmt.Printf("Compilation request for project: %s\n", req.ProjectID)
	}

	// Check queue capacity
	if len(requestQueue) >= cap(requestQueue) {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":         "Server busy",
			"message":       "Too many compilation requests. Please try again in a moment.",
			"queuePosition": len(requestQueue) + 1,
		})
		return
	}

	// Create job with result channel
	job := &CompileJob{
		Context:          c,
		Files:            files,
		ProjectID:        req.ProjectID,
		LastModifiedFile: req.LastModifiedFile,
		EnqueuedAt:       time.Now(),
		ResultChan:       make(chan *CompileResult, 1),
	}

	// Add to queue (non-blocking with timeout)
	select {
	case requestQueue <- job:
		// Wait for worker to send result back
		result := <-job.ResultChan

		// Set custom headers
		c.Header("X-Compile-Request-Id", result.RequestID)
		c.Header("X-Compile-Duration-Ms", fmt.Sprintf("%d", result.DurationMs))
		c.Header("X-Compile-Queue-Ms", fmt.Sprintf("%d", result.QueueMs))

		// Send response based on result
		if result.Success {
			c.Header("X-Compile-Sha256", result.SHA256)
			c.Header("Content-Type", "application/pdf")
			c.Header("Content-Length", fmt.Sprintf("%d", len(result.PDFData)))
			c.Header("Content-Disposition", "attachment; filename=\"compiled.pdf\"")
			c.Data(http.StatusOK, "application/pdf", result.PDFData)
		} else {
			errResp := ErrorResponse{
				Error:      "LaTeX compilation failed",
				Message:    result.ErrorMessage,
				RequestID:  result.RequestID,
				QueueMs:    result.QueueMs,
				DurationMs: result.DurationMs,
				Stdout:     result.Stdout,
				Stderr:     result.Stderr,
				Log:        result.LogTail,
			}
			// Include partial PDF if available (some errors produce partial output)
			if len(result.PDFData) > 0 {
				errResp.PdfBuffer = base64.StdEncoding.EncodeToString(result.PDFData)
			}
			c.JSON(http.StatusInternalServerError, errResp)
		}
	case <-time.After(10 * time.Second):
		c.JSON(http.StatusServiceUnavailable, ErrorResponse{
			Error:   "Server busy",
			Message: "Could not enqueue request, timeout",
		})
	}
}

// HandleCompilation processes a compilation job
func HandleCompilation(job *CompileJob) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("Recovered from panic in compilation: %v\n", r)
			// Send error result back through channel
			job.ResultChan <- &CompileResult{
				Success:      false,
				ErrorMessage: fmt.Sprintf("Internal server error: %v", r),
			}
		}
	}()

	comp := New()
	result := comp.Compile(job.Files, job.EnqueuedAt, job.ProjectID)

	// Send result back to handler through channel
	job.ResultChan <- result
}

// SynctexHandler handles SyncTeX forward/reverse lookup requests
func SynctexHandler(c *gin.Context) {
	startTime := time.Now()

	var req SynctexRequest
	if !bindJSON(c, &req) {
		return
	}

	if req.ProjectID == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Error:   "Invalid request",
			Message: "projectId is required",
		})
		return
	}

	if req.Direction != "forward" && req.Direction != "reverse" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Error:   "Invalid request",
			Message: "direction must be \"forward\" or \"reverse\"",
		})
		return
	}

	if req.Direction == "forward" {
		if req.File == "" {
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Error:   "Invalid request",
				Message: "file is required for forward sync",
			})
			return
		}
		if err := validateFilePath(req.File); err != nil {
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Error:   "Invalid request",
				Message: fmt.Sprintf("Invalid file path: %v", err),
			})
			return
		}
	}

	cache := GetCache()

	entry, exists := cache.Get(req.ProjectID)
	if !exists || entry.TempDir == "" {
		c.JSON(http.StatusNotFound, ErrorResponse{
			Error:   "Not found",
			Message: "No cached compilation found for this project. Compile first.",
		})
		return
	}

	cache.LockProject(req.ProjectID)
	defer cache.UnlockProject(req.ProjectID)

	// workDir is where latexmk ran and where .synctex.gz / .pdf live.
	// This matches compiler.go: cmd.Dir = filepath.Dir(texFilePath)
	texFilePath := filepath.Join(entry.TempDir, filepath.FromSlash(entry.MainFilePath))
	workDir := filepath.Dir(texFilePath)

	// Verify synctex.gz exists
	synctexPath := filepath.Join(workDir, entry.JobName+".synctex.gz")
	if _, err := os.Stat(synctexPath); err != nil {
		c.JSON(http.StatusNotFound, ErrorResponse{
			Error:   "Not found",
			Message: "SyncTeX data not available. Re-compile the project.",
		})
		return
	}

	resp := SynctexResponse{}

	if req.Direction == "forward" {
		positions, err := RunSynctexForward(entry.TempDir, workDir, entry.JobName, req.File, req.Line, req.Column)
		if err != nil {
			c.JSON(http.StatusInternalServerError, ErrorResponse{
				Error:   "SyncTeX failed",
				Message: err.Error(),
			})
			return
		}
		resp.PDFPositions = positions
	} else {
		positions, err := RunSynctexReverse(entry.TempDir, workDir, entry.JobName, req.Page, req.H, req.V)
		if err != nil {
			c.JSON(http.StatusInternalServerError, ErrorResponse{
				Error:   "SyncTeX failed",
				Message: err.Error(),
			})
			return
		}
		resp.CodePositions = positions
	}

	resp.DurationMs = time.Since(startTime).Milliseconds()
	c.JSON(http.StatusOK, resp)
}

// WordCountHandler handles LaTeX word count requests
func WordCountHandler(c *gin.Context) {
	startTime := time.Now()

	var req WordCountRequest
	if !bindJSON(c, &req) {
		return
	}

	if len(req.Files) == 0 {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Error:   "Invalid request",
			Message: "The files array must contain at least one file",
		})
		return
	}

	// CountWords writes these files to a temp dir, so the same path checks the
	// compile route runs apply here too.
	if errResp := validateFiles(req.Files); errResp != nil {
		c.JSON(http.StatusBadRequest, *errResp)
		return
	}

	result, err := CountWords(req.Files)
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{
			Error:   "Word count failed",
			Message: err.Error(),
		})
		return
	}

	result.DurationMs = time.Since(startTime).Milliseconds()
	c.JSON(http.StatusOK, result)
}
