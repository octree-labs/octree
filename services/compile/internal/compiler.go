package internal

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
)

const (
	MaxLogChars  = 5000
	LogTailLines = 80
)

var historyDir string
var compilationTimeout = 10 * time.Minute // Default timeout for LaTeX compilation

// SetCompilationTimeout sets the maximum time allowed for a single compilation
func SetCompilationTimeout(timeout time.Duration) {
	compilationTimeout = timeout
	log.Printf("Compilation timeout set to %v", timeout)
}

var usepackagePatternCache sync.Map

type latexEngine string

const (
	enginePdfLaTeX latexEngine = "pdflatex"
	engineXeLaTeX  latexEngine = "xelatex"
	engineLuaLaTeX latexEngine = "lualatex"
)

// SetHistoryDir sets the directory for compilation history logs
func SetHistoryDir(dir string) {
	historyDir = dir
}

type Compiler struct {
	RequestID string
}

func New() *Compiler {
	return &Compiler{
		RequestID: uuid.New().String(),
	}
}

type compileSession struct {
	compiler            *Compiler
	ctx                 context.Context
	cancel              context.CancelFunc
	files               []FileEntry
	projectID           string
	enqueuedAt          time.Time
	receivedAt          time.Time
	queueMs             int64
	mainContent         string
	mainFilePath        string
	jobName             string
	tempDir             string
	texFilePath         string
	pdfPath             string
	logPath             string
	fileChanges         *FileChanges
	isIncremental       bool
	shouldCleanup       bool
	metadata            *compileMetadata
	requiresShellEscape bool
	requiresPythonTex   bool
	stdout              bytes.Buffer
	stderr              bytes.Buffer
	exitCode            int
	bibTool             bibliographyTool
	engine              latexEngine
}

func newCompileSession(compiler *Compiler, files []FileEntry, enqueuedAt time.Time, projectID string) *compileSession {
	receivedAt := time.Now()
	queueMs := receivedAt.Sub(enqueuedAt).Milliseconds()

	// Create context with timeout for the entire compilation
	ctx, cancel := context.WithTimeout(context.Background(), compilationTimeout)

	session := &compileSession{
		compiler:      compiler,
		ctx:           ctx,
		cancel:        cancel,
		files:         files,
		projectID:     projectID,
		enqueuedAt:    enqueuedAt,
		receivedAt:    receivedAt,
		queueMs:       queueMs,
		shouldCleanup: true,
		metadata: &compileMetadata{
			RequestID:  compiler.RequestID,
			EnqueuedAt: enqueuedAt,
			ReceivedAt: receivedAt,
			QueueMs:    queueMs,
			Status:     "processing",
		},
		bibTool: bibliographyToolNone,
		engine:  enginePdfLaTeX,
	}

	session.logInitialDetails()

	return session
}

func (c *Compiler) Compile(files []FileEntry, enqueuedAt time.Time, projectID string) *CompileResult {
	session := newCompileSession(c, files, enqueuedAt, projectID)

	// Track active compilation for health monitoring
	RegisterActiveCompilation(c.RequestID, projectID)
	defer UnregisterActiveCompilation(c.RequestID)

	cache := GetCache()
	if session.projectID != "" {
		cache.LockProject(session.projectID)
		defer cache.UnlockProject(session.projectID)
	}

	if result := session.tryServeCachedPDF(cache); result != nil {
		return result
	}

	if errResult := session.prepareWorkspace(cache); errResult != nil {
		return errResult
	}
	defer session.cleanup()

	needsBib, needsMultiPass := session.determineStrategy()
	session.runCompilation(needsBib, needsMultiPass)

	return session.finalize(cache)
}

func (s *compileSession) logInitialDetails() {
	log.Printf("[%s] ==== COMPILE REQUEST RECEIVED ====", s.compiler.RequestID)
	if s.projectID != "" {
		log.Printf("[%s] ProjectID: %s", s.compiler.RequestID, s.projectID)
	}

	s.mainContent = s.extractMainContent()

	log.Printf("[%s] Queue wait: %dms", s.compiler.RequestID, s.queueMs)

	preview := s.mainContent[:min(120, len(s.mainContent))]
	preview = strings.ReplaceAll(preview, "\n", " ")
	log.Printf("[%s] TeX preview: %s...", s.compiler.RequestID, preview)

	if requiresShellEscape(s.mainContent, s.files) {
		s.requiresShellEscape = true
		log.Printf("[%s] Shell escape enabled (detected minted/pythontex usage)", s.compiler.RequestID)
	}

	if usesPythonTex(s.mainContent, s.files) {
		s.requiresPythonTex = true
		log.Printf("[%s] PythonTeX detected; pythontex helper will run between passes", s.compiler.RequestID)
	}

	engine, reason := s.detectEngine()
	s.engine = engine
	if s.metadata != nil {
		s.metadata.Engine = string(engine)
	}
	if reason != "" {
		log.Printf("[%s] Selected engine: %s (triggered by %s)", s.compiler.RequestID, engine, reason)
	} else {
		log.Printf("[%s] Selected engine: %s (default)", s.compiler.RequestID, engine)
	}
}

func (s *compileSession) detectEngine() (latexEngine, string) {
	var builder strings.Builder
	if s.mainContent != "" {
		builder.WriteString(s.mainContent)
		builder.WriteString("\n")
	}

	for _, file := range s.files {
		if file.Encoding == "base64" {
			continue
		}
		if !shouldInspectForEngine(file.Path) {
			continue
		}
		if file.Content == "" {
			continue
		}
		builder.WriteString(file.Content)
		builder.WriteString("\n")
	}

	content := strings.ToLower(builder.String())

	if reason := detectLuaEngineTrigger(content); reason != "" {
		return engineLuaLaTeX, reason
	}
	if reason := detectXeEngineTrigger(content); reason != "" {
		return engineXeLaTeX, reason
	}
	return enginePdfLaTeX, ""
}

func shouldInspectForEngine(path string) bool {
	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".tex"):
		return true
	case strings.HasSuffix(lower, ".sty"):
		return true
	case strings.HasSuffix(lower, ".cls"):
		return true
	case strings.HasSuffix(lower, ".ltx"):
		return true
	default:
		return false
	}
}

func detectLuaEngineTrigger(content string) string {
	triggers := []string{
		"\\directlua",
		"\\usepackage{luacode",
		"\\usepackage{luacolor",
		"\\usepackage{luatex",
		"\\usepackage{luaotfload",
		"\\usepackage{luapackageloader",
		"\\luaexec",
		"\\luadirect",
		"\\newluafunction",
		"\\begin{luacode",
	}

	for _, trigger := range triggers {
		if strings.Contains(content, trigger) {
			return trigger
		}
	}

	return ""
}

func detectXeEngineTrigger(content string) string {
	if containsUsepackage(content, "fontspec") {
		return "\\usepackage{fontspec}"
	}

	triggers := []string{
		"\\setmainfont",
		"\\setsansfont",
		"\\setmonofont",
		"\\newfontfamily",
		"\\usepackage{xecjk",
		"\\setcjkmainfont",
		"\\setcjkfamilyfont",
		"\\usepackage{polyglossia",
		"\\usepackage{mathspec",
		"\\usepackage{unicode-math",
		"\\xeprintrule",
		"\\defaultfontfeatures",
	}

	for _, trigger := range triggers {
		if strings.Contains(content, trigger) {
			return trigger
		}
	}

	return ""
}

func containsUsepackage(content, pkg string) bool {
	if pkg == "" {
		return false
	}

	if cached, ok := usepackagePatternCache.Load(pkg); ok {
		return cached.(*regexp.Regexp).MatchString(content)
	}

	pattern := fmt.Sprintf(`\\(?:use|require)package(?:\[[^\]]*\])?\{\s*%s\s*\}`, regexp.QuoteMeta(pkg))
	re := regexp.MustCompile(pattern)
	usepackagePatternCache.Store(pkg, re)

	return re.MatchString(content)
}

func (s *compileSession) extractMainContent() string {
	textFiles, binaryFiles := 0, 0
	for _, f := range s.files {
		switch f.Encoding {
		case "base64":
			binaryFiles++
		default:
			textFiles++
		}
	}
	log.Printf("[%s] Project files received: %d total (%d text, %d binary)", s.compiler.RequestID, len(s.files), textFiles, binaryFiles)

	mainFile, hasDocclass, found := findMainFile(s.files)
	if !found {
		log.Printf("[%s] Warning: No LaTeX source file detected in request", s.compiler.RequestID)
		s.mainFilePath = ""
		return ""
	}

	s.mainFilePath = mainFile.Path

	if hasDocclass {
		log.Printf("[%s] Detected main file by \\documentclass: %s", s.compiler.RequestID, mainFile.Path)
	} else {
		log.Printf("[%s] Warning: No \\documentclass found; using first .tex file: %s", s.compiler.RequestID, mainFile.Path)
	}

	return mainFile.Content
}

func findMainFile(files []FileEntry) (FileEntry, bool, bool) {
	var fallback *FileEntry

	for i := range files {
		file := files[i]
		switch {
		case file.Encoding == "base64":
			continue
		case !strings.HasSuffix(file.Path, ".tex"):
			continue
		case strings.Contains(file.Content, "\\documentclass"):
			return file, true, true
		case fallback == nil:
			fallback = &files[i]
		}
	}

	if fallback != nil {
		return *fallback, false, true
	}

	return FileEntry{}, false, false
}

func (s *compileSession) attachCachedTempDir(cache *CompilationCache) {
	if s.projectID == "" {
		return
	}

	entry, exists := cache.Get(s.projectID)
	if !exists || entry.TempDir == "" {
		return
	}

	if _, err := os.Stat(entry.TempDir); err != nil {
		log.Printf("[%s] Cached temp dir %s unavailable: %v", s.compiler.RequestID, entry.TempDir, err)
		return
	}

	log.Printf("[%s] Using cached temp directory: %s", s.compiler.RequestID, entry.TempDir)
	s.tempDir = entry.TempDir
	s.isIncremental = true
	s.shouldCleanup = false

	s.fileChanges = diffFiles(s.files, entry.FileHashes)
	changeCount := len(s.fileChanges.Added) + len(s.fileChanges.Modified) + len(s.fileChanges.Deleted)
	log.Printf("[%s] File changes: %d added, %d modified, %d deleted (total: %d)",
		s.compiler.RequestID, len(s.fileChanges.Added), len(s.fileChanges.Modified), len(s.fileChanges.Deleted), changeCount)
	log.Printf("[%s] Change types: tex=%v bib=%v assets=%v",
		s.compiler.RequestID, s.fileChanges.HasTexChanges, s.fileChanges.HasBibChanges, s.fileChanges.HasAssetChanges)
}

func (s *compileSession) ensureTempDir() *CompileResult {
	if s.tempDir != "" {
		return nil
	}

	dir, err := os.MkdirTemp("", "latex-*")
	if err != nil {
		return s.compiler.errorResult(s.metadata, fmt.Sprintf("Failed to create temp directory: %v", err), s.queueMs, s.receivedAt)
	}

	s.tempDir = dir
	log.Printf("[%s] Created new temp directory: %s", s.compiler.RequestID, s.tempDir)

	if s.projectID != "" {
		s.shouldCleanup = false
		log.Printf("[%s] Temp directory will be cached for project: %s", s.compiler.RequestID, s.projectID)
	}

	return nil
}

func (s *compileSession) resolveMainFilePaths() *CompileResult {
	if s.mainFilePath == "" {
		return s.compiler.errorResult(s.metadata, "No LaTeX source (.tex) file found in request", s.queueMs, s.receivedAt)
	}

	texPath := filepath.Join(s.tempDir, filepath.FromSlash(s.mainFilePath))
	s.texFilePath = texPath
	jobName := strings.TrimSuffix(filepath.Base(texPath), filepath.Ext(texPath))
	s.pdfPath = filepath.Join(s.tempDir, fmt.Sprintf("%s.pdf", jobName))
	s.logPath = filepath.Join(s.tempDir, fmt.Sprintf("%s.log", jobName))
	s.jobName = jobName

	return nil
}

func (s *compileSession) syncFilesToWorkspace() *CompileResult {
	switch {
	case s.isIncremental && s.fileChanges != nil:
		if err := updateCachedFiles(s.tempDir, s.fileChanges); err != nil {
			return s.compiler.errorResult(s.metadata, fmt.Sprintf("Failed to update files: %v", err), s.queueMs, s.receivedAt)
		}
		log.Printf("[%s] Incremental update: wrote %d changed files", s.compiler.RequestID,
			len(s.fileChanges.Added)+len(s.fileChanges.Modified)+len(s.fileChanges.Deleted))
		return nil
	default:
		if err := createFileStructure(s.tempDir, s.files); err != nil {
			return s.compiler.errorResult(s.metadata, fmt.Sprintf("Failed to write files: %v", err), s.queueMs, s.receivedAt)
		}
		log.Printf("[%s] Project structure written to: %s", s.compiler.RequestID, s.tempDir)
		return nil
	}
}

func (s *compileSession) tryServeCachedPDF(cache *CompilationCache) *CompileResult {
	if s.projectID == "" {
		return nil
	}

	contentHash := HashFileSet(s.files)
	if !cache.CheckContentHash(s.projectID, contentHash) {
		return nil
	}

	entry, _ := cache.Get(s.projectID)
	if entry == nil || len(entry.LastPDFData) == 0 {
		return nil
	}

	log.Printf("[%s] CACHE HIT: Content unchanged, returning cached PDF", s.compiler.RequestID)
	completedAt := time.Now()
	durationMs := completedAt.Sub(s.receivedAt).Milliseconds()

	return &CompileResult{
		RequestID:  s.compiler.RequestID,
		Success:    true,
		PDFData:    entry.LastPDFData,
		SHA256:     entry.LastSHA256,
		QueueMs:    s.queueMs,
		DurationMs: durationMs,
		PDFSize:    len(entry.LastPDFData),
		CacheHit:   true,
	}
}

func (s *compileSession) prepareWorkspace(cache *CompilationCache) *CompileResult {
	s.attachCachedTempDir(cache)

	if result := s.ensureTempDir(); result != nil {
		return result
	}

	if result := s.resolveMainFilePaths(); result != nil {
		return result
	}

	if result := s.syncFilesToWorkspace(); result != nil {
		return result
	}

	s.removeStaleOutputs()

	s.metadata.Status = "written"
	s.compiler.persistMetadata(s.metadata)
	log.Printf("[%s] TeX content written to: %s", s.compiler.RequestID, s.texFilePath)

	return nil
}

func (s *compileSession) removeStaleOutputs() {
	if s.pdfPath != "" {
		if err := os.Remove(s.pdfPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Printf("[%s] Warning: failed to remove stale PDF %s: %v", s.compiler.RequestID, s.pdfPath, err)
		}
	}

	if s.logPath != "" {
		if err := os.Remove(s.logPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Printf("[%s] Warning: failed to remove stale log %s: %v", s.compiler.RequestID, s.logPath, err)
		}
	}
}

func (s *compileSession) determineStrategy() (bool, bool) {
	needsBib := needsBibliography(s.mainContent, s.files)
	needsMultiPass := needsMultiplePasses(s.mainContent)

	if needsBib {
		s.bibTool = detectBibliographyTool(s.mainContent, s.files)
		if s.bibTool == bibliographyToolNone {
			s.bibTool = bibliographyToolBibtex
		}
	} else {
		s.bibTool = bibliographyToolNone
	}

	if s.isIncremental && s.fileChanges != nil {
		needsBib, needsMultiPass = s.adjustStrategyForIncremental(needsBib, needsMultiPass)
	}

	if !needsBib {
		s.bibTool = bibliographyToolNone
	}

	log.Printf("[%s] Compilation strategy - Bibliography: %v (%s), Multi-pass: %v, Incremental: %v",
		s.compiler.RequestID, needsBib, s.bibTool.String(), needsMultiPass, s.isIncremental)
	return needsBib, needsMultiPass
}

func (s *compileSession) adjustStrategyForIncremental(needsBib bool, needsMultiPass bool) (bool, bool) {
	changes := s.fileChanges
	if changes == nil {
		return needsBib, needsMultiPass
	}

	hasBibliographyConfigured := needsBib || s.bibTool != bibliographyToolNone

	if !changes.HasBibChanges {
		switch {
		case !changes.HasTexChanges && changes.HasAssetChanges:
			log.Printf("[%s] INCREMENTAL: Only assets changed, single pass", s.compiler.RequestID)
			return false, false
		case !changes.HasTexChanges && !changes.HasAssetChanges:
			log.Printf("[%s] INCREMENTAL: No changes detected", s.compiler.RequestID)
			return false, false
		default:
			if !hasBibliographyConfigured {
				log.Printf("[%s] INCREMENTAL: .tex changed without bibliography; single pass", s.compiler.RequestID)
				return false, needsMultiPass
			}

			// .tex changed (with/without assets); still run bibliography to refresh citations.
			log.Printf("[%s] INCREMENTAL: .tex changed with existing bibliography; rerunning bibliography processor", s.compiler.RequestID)
			return true, needsMultiPass
		}
	}

	if !changes.HasTexChanges {
		if !hasBibliographyConfigured {
			log.Printf("[%s] INCREMENTAL: Bibliography changes detected but no bibliography configured; single pass", s.compiler.RequestID)
			return false, needsMultiPass
		}

		log.Printf("[%s] INCREMENTAL: Only .bib/assets changed (could skip first pdflatex)", s.compiler.RequestID)
		return true, needsMultiPass
	}

	return needsBib, needsMultiPass
}

func (s *compileSession) runCompilation(needsBib, needsMultiPass bool) {
	s.exitCode = 0

	log.Printf("[%s] Delegating compilation to latexmk (bib=%v, multi-pass=%v, pythontex=%v)",
		s.compiler.RequestID, needsBib, needsMultiPass, s.requiresPythonTex)

	s.recordExitCode(s.runLatexmk("initial"))

	if s.exitCode == 0 && s.requiresPythonTex {
		s.recordExitCode(s.runPythonTex())
		if s.exitCode == 0 {
			s.recordExitCode(s.runLatexmk("post-pythontex"))
		}
	}
}

func (s *compileSession) runLatexmk(stage string) error {
	log.Printf("[%s] Running latexmk (%s) with engine=%s (timeout: %v)", s.compiler.RequestID, stage, s.engine, compilationTimeout)

	engineOpts := []string{
		"-interaction=nonstopmode",
		"-file-line-error",
		"-synctex=1",
	}
	if s.requiresShellEscape {
		engineOpts = append(engineOpts, "-shell-escape")
	}
	latexCommand := fmt.Sprintf("%s %s %%O %%S", s.engine.command(), strings.Join(engineOpts, " "))

	args := []string{
		"-silent",
		"-f",
	}
	// Only force full rebuild on non-incremental (first) compiles.
	// For incremental builds, let latexmk reuse .aux/.bbl/.toc files for speed.
	if !s.isIncremental {
		args = append(args, "-gg")
	}

	// Use correct latexmk flag for each engine
	switch s.engine {
	case engineXeLaTeX:
		args = append(args, "-xelatex", "-pdfxelatex="+latexCommand)
	case engineLuaLaTeX:
		args = append(args, "-lualatex", "-pdflualatex="+latexCommand)
	default:
		args = append(args, "-pdf", "-pdflatex="+latexCommand)
	}

	// Use CommandContext for timeout support
	cmd := exec.CommandContext(s.ctx, "latexmk", append(args, filepath.Base(s.texFilePath))...)
	cmd.Dir = filepath.Dir(s.texFilePath)
	cmd.Stdout = &s.stdout
	cmd.Stderr = &s.stderr

	// Set TEXINPUTS to include the project root directory so .sty/.cls files
	// in the root can be found even when main.tex is in a subdirectory
	texInputs := fmt.Sprintf(".:%s:", s.tempDir)
	cmd.Env = append(os.Environ(), "TEXINPUTS="+texInputs)

	// Create a new process group so we can kill all child processes on timeout
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	// Start the command manually so we can kill the process group on timeout
	if err := cmd.Start(); err != nil {
		return err
	}

	// Wait for completion or timeout
	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	var err error
	select {
	case <-s.ctx.Done():
		// Timeout: kill the entire process group (negative PID)
		if cmd.Process != nil {
			log.Printf("[%s] Killing process group %d due to timeout", s.compiler.RequestID, cmd.Process.Pid)
			syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
		<-done // Wait for the process to actually exit
		err = fmt.Errorf("compilation timeout exceeded (%v)", compilationTimeout)
	case err = <-done:
		// Process completed normally
	}
	if err != nil {
		log.Printf("[%s] latexmk (%s) exited with error: %v", s.compiler.RequestID, stage, err)
	} else {
		log.Printf("[%s] latexmk (%s) completed successfully", s.compiler.RequestID, stage)
	}
	return err
}

func (s *compileSession) runPythonTex() error {
	log.Printf("[%s] Running pythontex helper...", s.compiler.RequestID)
	cmd := exec.CommandContext(s.ctx, "pythontex", filepath.Base(s.texFilePath))
	cmd.Dir = s.tempDir
	cmd.Stdout = &s.stdout
	cmd.Stderr = &s.stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	if err := cmd.Start(); err != nil {
		return err
	}

	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	var err error
	select {
	case <-s.ctx.Done():
		if cmd.Process != nil {
			log.Printf("[%s] Killing pythontex process group %d due to timeout", s.compiler.RequestID, cmd.Process.Pid)
			syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
		<-done
		err = fmt.Errorf("compilation timeout exceeded (%v)", compilationTimeout)
	case err = <-done:
	}

	if err != nil {
		log.Printf("[%s] pythontex exited with error: %v", s.compiler.RequestID, err)
	} else {
		log.Printf("[%s] pythontex completed successfully", s.compiler.RequestID)
	}
	return err
}

func (s *compileSession) recordExitCode(err error) {
	if err == nil {
		return
	}

	if exitError, ok := err.(*exec.ExitError); ok {
		s.exitCode = exitError.ExitCode()
	} else {
		s.exitCode = -1
	}
}

func (s *compileSession) finalize(cache *CompilationCache) *CompileResult {
	completedAt := time.Now()
	durationMs := completedAt.Sub(s.receivedAt).Milliseconds()

	s.metadata.CompletedAt = completedAt
	s.metadata.DurationMs = durationMs
	s.metadata.ExitCode = s.exitCode
	s.metadata.StdoutBytes = s.stdout.Len()
	s.metadata.StderrBytes = s.stderr.Len()

	log.Printf("[%s] Compilation completed with exit code: %d", s.compiler.RequestID, s.exitCode)
	log.Printf("[%s] Total stdout length: %d bytes", s.compiler.RequestID, s.stdout.Len())
	log.Printf("[%s] Total stderr length: %d bytes", s.compiler.RequestID, s.stderr.Len())

	if pdfData, err := os.ReadFile(s.pdfPath); err == nil {
		log.Printf("[%s] PDF created successfully: %d bytes", s.compiler.RequestID, len(pdfData))

		if len(pdfData) < 4 || string(pdfData[:4]) != "%PDF" {
			return s.compiler.errorResult(s.metadata, "Invalid PDF format", s.queueMs, s.receivedAt)
		}

		hash := sha256.Sum256(pdfData)
		sha256Hex := hex.EncodeToString(hash[:])

		logContent := ""
		if logData, err := os.ReadFile(s.logPath); err == nil {
			logContent = string(logData)
		}

		s.metadata.LogTail = tailLines(truncateText(logContent, MaxLogChars), LogTailLines)

		// LaTeX exit codes:
		// 0 = success with no warnings
		// 1 = fatal error (no PDF)
		// 2 = success with warnings (e.g., missing citations, undefined references)
		// Since we have a valid PDF, treat exit codes 0-2 as success
		if s.exitCode > 2 {
			errMsg := fmt.Sprintf("LaTeX toolchain exited with code %d", s.exitCode)
			log.Printf("[%s] Compilation produced PDF but exited with code %d", s.compiler.RequestID, s.exitCode)
			s.metadata.Status = "error"
			s.metadata.Error = errMsg
			s.compiler.persistMetadata(s.metadata)

			return &CompileResult{
				RequestID:    s.compiler.RequestID,
				Success:      false,
				PDFData:      pdfData, // Include partial PDF even on error
				ErrorMessage: errMsg,
				Stdout:       truncateText(s.stdout.String(), MaxLogChars),
				Stderr:       truncateText(s.stderr.String(), MaxLogChars),
				LogTail:      s.metadata.LogTail,
				QueueMs:      s.queueMs,
				DurationMs:   durationMs,
			}
		}

		if s.exitCode == 2 {
			log.Printf("[%s] LaTeX completed with warnings (exit code 2), but PDF was generated successfully", s.compiler.RequestID)
		}

		s.metadata.Status = "success"
		s.metadata.PDFSize = len(pdfData)
		s.metadata.SHA256 = sha256Hex
		s.compiler.persistMetadata(s.metadata)

		if s.projectID != "" {
			contentHash := HashFileSet(s.files)
			fileHashes := buildFileHashMap(s.files)

			cacheEntry := &CacheEntry{
				ProjectID:      s.projectID,
				TempDir:        s.tempDir,
				FileHashes:     fileHashes,
				ContentHash:    contentHash,
				LastPDFData:    pdfData,
				LastSHA256:     sha256Hex,
				LastAccessTime: time.Now(),
				MainFilePath:   s.mainFilePath,
				JobName:        s.jobName,
			}

			cache.Set(s.projectID, cacheEntry)
			log.Printf("[%s] Cached compilation result for project %s", s.compiler.RequestID, s.projectID)
		}

		log.Printf("[%s] Compilation successful", s.compiler.RequestID)

		return &CompileResult{
			RequestID:  s.compiler.RequestID,
			Success:    true,
			PDFData:    pdfData,
			SHA256:     sha256Hex,
			QueueMs:    s.queueMs,
			DurationMs: durationMs,
			PDFSize:    len(pdfData),
			CacheHit:   false,
		}
	}

	logContent := ""
	if logData, err := os.ReadFile(s.logPath); err == nil {
		logContent = string(logData)
		log.Printf("[%s] LaTeX log excerpt: %s", s.compiler.RequestID, logContent[:min(500, len(logContent))])
	}

	s.metadata.Status = "error"
	s.metadata.LogTail = tailLines(logContent, LogTailLines)
	s.compiler.persistMetadata(s.metadata)

	return &CompileResult{
		RequestID:    s.compiler.RequestID,
		Success:      false,
		ErrorMessage: "PDF file not generated",
		Stdout:       truncateText(s.stdout.String(), MaxLogChars),
		Stderr:       truncateText(s.stderr.String(), MaxLogChars),
		LogTail:      s.metadata.LogTail,
		QueueMs:      s.queueMs,
		DurationMs:   durationMs,
	}
}

func (s *compileSession) cleanup() {
	// Cancel context to ensure any running processes are killed
	if s.cancel != nil {
		s.cancel()
	}

	if s.shouldCleanup && s.tempDir != "" {
		_ = os.RemoveAll(s.tempDir)
	}
}

func (c *Compiler) errorResult(metadata *compileMetadata, message string, queueMs int64, receivedAt time.Time) *CompileResult {
	metadata.Status = "error"
	metadata.Error = message
	metadata.CompletedAt = time.Now()
	metadata.DurationMs = metadata.CompletedAt.Sub(receivedAt).Milliseconds()
	c.persistMetadata(metadata)

	log.Printf("[%s] Error: %s", c.RequestID, message)

	return &CompileResult{
		RequestID:    c.RequestID,
		Success:      false,
		ErrorMessage: message,
		QueueMs:      queueMs,
		DurationMs:   metadata.DurationMs,
	}
}

func (c *Compiler) persistMetadata(metadata *compileMetadata) {
	if historyDir == "" {
		return
	}

	data, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		log.Printf("[%s] Failed to marshal metadata: %v", c.RequestID, err)
		return
	}

	filePath := filepath.Join(historyDir, fmt.Sprintf("%s.json", c.RequestID))
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		log.Printf("[%s] Failed to persist metadata: %v", c.RequestID, err)
	}
}

func (e latexEngine) command() string {
	switch e {
	case engineXeLaTeX:
		return "xelatex"
	case engineLuaLaTeX:
		return "lualatex"
	default:
		return "pdflatex"
	}
}
