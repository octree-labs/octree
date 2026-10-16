package internal

import (
	"crypto/sha256"
	"encoding/hex"
	"log"
	"os"
	"sync"
	"time"
)

const (
	CacheExpirationTime = 30 * time.Minute // Evict after 30 minutes of inactivity
	MaxCachedProjects   = 15                // Maximum number of projects to cache
	CleanupInterval     = 5 * time.Minute   // Run cleanup every 5 minutes
)

// CacheEntry represents a cached compilation for a project
type CacheEntry struct {
	ProjectID      string
	TempDir        string
	FileHashes     map[string]string // path -> hash
	ContentHash    string            // Hash of all file content
	LastPDFData    []byte
	LastSHA256     string
	LastAccessTime time.Time
	MainFilePath   string     // Relative path to main .tex file (e.g. "main.tex")
	JobName        string     // TeX job name (filename without extension)
	mutex          sync.Mutex // Lock for this cache entry
}

// CompilationCache manages cached compilation directories
type CompilationCache struct {
	entries      map[string]*CacheEntry // projectID -> CacheEntry
	projectLocks map[string]*sync.Mutex // projectID -> lock for serializing requests
	globalMutex  sync.RWMutex           // Protects the maps
}

var globalCache *CompilationCache
var cacheOnce sync.Once

// GetCache returns the global cache instance
func GetCache() *CompilationCache {
	cacheOnce.Do(func() {
		globalCache = &CompilationCache{
			entries:      make(map[string]*CacheEntry),
			projectLocks: make(map[string]*sync.Mutex),
		}
		// Start cleanup goroutine
		go globalCache.cleanupLoop()
	})
	return globalCache
}

// LockProject acquires a lock for the given project to serialize compilations
func (c *CompilationCache) LockProject(projectID string) {
	if projectID == "" {
		return
	}

	c.globalMutex.Lock()
	if _, exists := c.projectLocks[projectID]; !exists {
		c.projectLocks[projectID] = &sync.Mutex{}
	}
	lock := c.projectLocks[projectID]
	c.globalMutex.Unlock()

	lock.Lock()
}

// UnlockProject releases the lock for the given project
func (c *CompilationCache) UnlockProject(projectID string) {
	if projectID == "" {
		return
	}

	c.globalMutex.RLock()
	if lock, exists := c.projectLocks[projectID]; exists {
		lock.Unlock()
	}
	c.globalMutex.RUnlock()
}

// Get retrieves a cache entry for the given project
func (c *CompilationCache) Get(projectID string) (*CacheEntry, bool) {
	if projectID == "" {
		return nil, false
	}

	c.globalMutex.RLock()
	entry, exists := c.entries[projectID]
	if exists {
		entry.mutex.Lock()
		entry.LastAccessTime = time.Now()
		entry.mutex.Unlock()
	}
	c.globalMutex.RUnlock()

	return entry, exists
}

// Set stores or updates a cache entry for the given project
func (c *CompilationCache) Set(projectID string, entry *CacheEntry) {
	if projectID == "" {
		return
	}

	entry.LastAccessTime = time.Now()

	c.globalMutex.Lock()
	defer c.globalMutex.Unlock()

	// Check if we need to evict (LRU)
	if len(c.entries) >= MaxCachedProjects {
		// Don't evict if we're updating an existing entry
		if _, exists := c.entries[projectID]; !exists {
			c.evictOldestLocked()
		}
	}

	c.entries[projectID] = entry
}

// CheckContentHash checks if the content hash matches the cached hash
func (c *CompilationCache) CheckContentHash(projectID, contentHash string) bool {
	entry, exists := c.Get(projectID)
	if !exists {
		return false
	}

	entry.mutex.Lock()
	defer entry.mutex.Unlock()

	return entry.ContentHash == contentHash
}

// evictOldestLocked evicts the oldest cache entry (must be called with globalMutex held)
func (c *CompilationCache) evictOldestLocked() {
	var oldestID string
	var oldestTime time.Time

	for id, entry := range c.entries {
		entry.mutex.Lock()
		accessTime := entry.LastAccessTime
		entry.mutex.Unlock()

		if oldestID == "" || accessTime.Before(oldestTime) {
			oldestID = id
			oldestTime = accessTime
		}
	}

	if oldestID != "" {
		c.removeEntryLocked(oldestID)
		log.Printf("[CACHE] Evicted oldest entry: %s (LRU)", oldestID)
	}
}

// removeEntryLocked removes a cache entry and cleans up resources (must be called with globalMutex held)
func (c *CompilationCache) removeEntryLocked(projectID string) {
	if entry, exists := c.entries[projectID]; exists {
		// Clean up temp directory
		entry.mutex.Lock()
		tempDir := entry.TempDir
		entry.mutex.Unlock()

		if tempDir != "" {
			if err := os.RemoveAll(tempDir); err != nil {
				log.Printf("[CACHE] Failed to remove temp dir %s: %v", tempDir, err)
			} else {
				log.Printf("[CACHE] Cleaned up temp dir: %s", tempDir)
			}
		}

		delete(c.entries, projectID)
	}

	// Clean up lock
	delete(c.projectLocks, projectID)
}

// cleanupLoop runs periodically to evict expired cache entries
func (c *CompilationCache) cleanupLoop() {
	ticker := time.NewTicker(CleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		c.cleanup()
	}
}

// cleanup evicts expired cache entries
func (c *CompilationCache) cleanup() {
	c.globalMutex.Lock()
	defer c.globalMutex.Unlock()

	now := time.Now()
	var toRemove []string

	for id, entry := range c.entries {
		entry.mutex.Lock()
		lastAccess := entry.LastAccessTime
		entry.mutex.Unlock()

		if now.Sub(lastAccess) > CacheExpirationTime {
			toRemove = append(toRemove, id)
		}
	}

	for _, id := range toRemove {
		c.removeEntryLocked(id)
		log.Printf("[CACHE] Evicted expired entry: %s (30min timeout)", id)
	}

	if len(toRemove) > 0 {
		log.Printf("[CACHE] Cleanup completed: %d entries evicted, %d entries remain", len(toRemove), len(c.entries))
	}
}

// Stats returns cache statistics
func (c *CompilationCache) Stats() map[string]interface{} {
	c.globalMutex.RLock()
	defer c.globalMutex.RUnlock()

	return map[string]interface{}{
		"entries":     len(c.entries),
		"maxEntries":  MaxCachedProjects,
		"expirationMinutes": int(CacheExpirationTime.Minutes()),
	}
}

// HashFileContent generates a SHA256 hash of file content
func HashFileContent(content string) string {
	hash := sha256.Sum256([]byte(content))
	return hex.EncodeToString(hash[:])
}

// HashFileSet generates a SHA256 hash of all files in the set
func HashFileSet(files []FileEntry) string {
	hasher := sha256.New()
	
	for _, file := range files {
		// Include path and content in hash
		hasher.Write([]byte(file.Path))
		hasher.Write([]byte{0}) // Separator
		hasher.Write([]byte(file.Content))
		hasher.Write([]byte{0}) // Separator
	}
	
	return hex.EncodeToString(hasher.Sum(nil))
}

