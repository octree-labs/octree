package main

import (
	"compress/gzip"
	"context"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/octree/latex-compile/internal"
)

const (
	DefaultPort               = "3001"
	MaxConcurrentRequests     = 2
	DefaultCompilationTimeout = 10 * time.Minute // Default 10 minutes for complex documents
	ShutdownTimeout           = 60 * time.Second
	// MaxRequestBodyBytes caps a compile request, both on the wire and after
	// gzip decompression. The app's own route limit is 25 MB; projects with
	// base64 images are the largest real payloads.
	MaxRequestBodyBytes = 64 << 20
)

var requestQueue chan *internal.CompileJob

func main() {
	// Setup
	port := os.Getenv("PORT")
	if port == "" {
		port = DefaultPort
	}

	historyDir := os.Getenv("HISTORY_DIR")
	if historyDir == "" {
		historyDir = "./logs"
	}

	// Create history directory
	if err := os.MkdirAll(historyDir, 0755); err != nil {
		log.Printf("Warning: Failed to create history directory: %v", err)
	}

	// Set history dir for compiler
	internal.SetHistoryDir(historyDir)

	// Configure compilation timeout
	compilationTimeout := DefaultCompilationTimeout
	if timeoutStr := os.Getenv("COMPILATION_TIMEOUT_SECONDS"); timeoutStr != "" {
		if seconds, err := strconv.Atoi(timeoutStr); err == nil && seconds > 0 {
			compilationTimeout = time.Duration(seconds) * time.Second
		}
	}
	internal.SetCompilationTimeout(compilationTimeout)

	// Initialize request queue
	requestQueue = make(chan *internal.CompileJob, MaxConcurrentRequests*2)
	internal.SetRequestQueue(requestQueue)

	// Start workers
	for i := 0; i < MaxConcurrentRequests; i++ {
		go worker(i)
	}

	// Setup router
	router := setupRouter()

	// Create server
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      router,
		ReadTimeout:  10 * time.Minute,
		WriteTimeout: 10 * time.Minute,
		IdleTimeout:  20 * time.Minute,
	}

	// Start server in goroutine
	go func() {
		log.Printf("LaTeX compilation server starting on port %s", port)
		log.Printf("Max concurrent requests: %d", MaxConcurrentRequests)
		log.Printf("Compilation timeout: %v", compilationTimeout)
		log.Printf("Health check: http://localhost:%s/health", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), ShutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exited")
}

func setupRouter() *gin.Engine {
	// Set Gin mode
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.Default()

	// CORS middleware
	router.Use(corsMiddleware())
	// Cap request bodies before anything reads them
	router.Use(bodyLimitMiddleware())
	// Transparently decompress gzip request bodies
	router.Use(gzipRequestMiddleware())

	// Routes
	router.GET("/health", internal.HealthHandler)
	router.POST("/word-count", internal.WordCountHandler)

	// Protected routes requiring JWT
	protected := router.Group("/")
	protected.Use(internal.JWTAuthMiddleware(authConfigFromEnv()))
	{
		protected.POST("/compile", internal.CompileHandler)
		protected.POST("/synctex", internal.SynctexHandler)
	}

	return router
}

// authConfigFromEnv reads the token policy. SUPABASE_JWT_SECRET is the
// project's JWT secret; SUPABASE_JWT_ISSUER (optional) pins user tokens to
// one Supabase project, e.g. https://<ref>.supabase.co/auth/v1.
func authConfigFromEnv() internal.AuthConfig {
	return internal.AuthConfig{
		Secret: os.Getenv("SUPABASE_JWT_SECRET"),
		Issuer: os.Getenv("SUPABASE_JWT_ISSUER"),
	}
}

// bodyLimitMiddleware caps the raw request body; a body over the limit makes
// the JSON bind fail with *http.MaxBytesError (handlers answer 413).
func bodyLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxRequestBodyBytes)
		}
		c.Next()
	}
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Content-Encoding")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

// gzipRequestMiddleware transparently decompresses gzip-encoded request bodies.
// Clients send Content-Encoding: gzip to reduce upload size for large LaTeX projects.
func gzipRequestMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader("Content-Encoding") != "gzip" {
			c.Next()
			return
		}

		reader, err := gzip.NewReader(c.Request.Body)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid gzip request body"})
			return
		}
		defer reader.Close()

		// The raw body is already capped; cap the decompressed stream too so a
		// small gzip bomb cannot expand past the same limit.
		c.Request.Body = http.MaxBytesReader(c.Writer, io.NopCloser(reader), MaxRequestBodyBytes)
		c.Request.Header.Del("Content-Encoding")
		c.Request.ContentLength = -1

		c.Next()
	}
}

func worker(id int) {
	log.Printf("Worker %d started", id)
	for job := range requestQueue {
		internal.HandleCompilation(job)
	}
	log.Printf("Worker %d stopped", id)
}
