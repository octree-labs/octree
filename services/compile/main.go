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
	"github.com/golang-jwt/jwt/v5"
	"github.com/octree/latex-compile/internal"
)

const (
	DefaultPort               = "3001"
	MaxConcurrentRequests     = 2
	DefaultCompilationTimeout = 10 * time.Minute // Default 10 minutes for complex documents
	ShutdownTimeout           = 60 * time.Second
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
	// Transparently decompress gzip request bodies
	router.Use(gzipRequestMiddleware())

	// Routes
	router.GET("/health", internal.HealthHandler)
	router.POST("/word-count", internal.WordCountHandler)

	// Protected routes requiring JWT
	protected := router.Group("/")
	protected.Use(jwtAuthMiddleware())
	{
		protected.POST("/compile", internal.CompileHandler)
		protected.POST("/synctex", internal.SynctexHandler)
	}

	return router
}

func jwtAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		jwtSecret := os.Getenv("SUPABASE_JWT_SECRET")
		if jwtSecret == "" {
			c.Next()
			return
		}

		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			return
		}

		const prefix = "Bearer "
		if len(authHeader) < len(prefix) || authHeader[:len(prefix)] != prefix {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization header format"})
			return
		}

		tokenString := authHeader[len(prefix):]

		token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(jwtSecret), nil
		}, jwt.WithValidMethods([]string{"HS256"}))

		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			return
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

		c.Request.Body = io.NopCloser(reader)
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
