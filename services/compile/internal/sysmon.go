package internal

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// CPU tracking state
var (
	lastCPUStats cpuStats
	lastCPUTime  time.Time
	cpuMutex     sync.Mutex
)

type cpuStats struct {
	user    uint64
	nice    uint64
	system  uint64
	idle    uint64
	iowait  uint64
	irq     uint64
	softirq uint64
}

// ActiveCompilation tracks a running compilation
type ActiveCompilation struct {
	RequestID string
	StartTime time.Time
	ProjectID string
}

var (
	activeCompilations = make(map[string]*ActiveCompilation)
	activeCompMutex    sync.RWMutex
)

// RegisterActiveCompilation marks a compilation as active
func RegisterActiveCompilation(requestID, projectID string) {
	activeCompMutex.Lock()
	defer activeCompMutex.Unlock()
	activeCompilations[requestID] = &ActiveCompilation{
		RequestID: requestID,
		StartTime: time.Now(),
		ProjectID: projectID,
	}
}

// UnregisterActiveCompilation removes a compilation from active tracking
func UnregisterActiveCompilation(requestID string) {
	activeCompMutex.Lock()
	defer activeCompMutex.Unlock()
	delete(activeCompilations, requestID)
}

// GetActiveCompilationCount returns the number of active compilations
func GetActiveCompilationCount() int {
	activeCompMutex.RLock()
	defer activeCompMutex.RUnlock()
	return len(activeCompilations)
}

// GetSystemStats collects system statistics for health checks
func GetSystemStats() (*SystemStats, []string) {
	var issues []string
	stats := &SystemStats{
		GoRoutines:         runtime.NumGoroutine(),
		ActiveCompilations: GetActiveCompilationCount(),
	}

	// Go memory stats
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)
	stats.GoMemAllocMB = memStats.Alloc / 1024 / 1024

	// System memory (Linux)
	if mem, err := getSystemMemory(); err == nil {
		stats.MemoryUsedMB = mem.used / 1024 / 1024
		stats.MemoryTotalMB = mem.total / 1024 / 1024
		if mem.total > 0 {
			stats.MemoryPercent = float64(mem.used) / float64(mem.total) * 100
		}
		// Check memory threshold
		if stats.MemoryPercent > 90 {
			issues = append(issues, fmt.Sprintf("High memory usage: %.1f%%", stats.MemoryPercent))
		}
	}

	// CPU usage (Linux)
	if cpu, err := getCPUPercent(); err == nil {
		stats.CPUPercent = cpu
		// Check CPU threshold
		if cpu > 95 {
			issues = append(issues, fmt.Sprintf("High CPU usage: %.1f%%", cpu))
		}
	}

	// Check for stuck processes
	stuckProcs := detectStuckProcesses()
	if len(stuckProcs) > 0 {
		stats.StuckProcesses = stuckProcs
		for _, p := range stuckProcs {
			issues = append(issues, fmt.Sprintf("Stuck process detected: PID %d (%s) running for %s", p.PID, p.Command, p.RunningFor))
		}
	}

	// Check for long-running compilations
	activeCompMutex.RLock()
	for _, comp := range activeCompilations {
		duration := time.Since(comp.StartTime)
		if duration > 8*time.Minute { // Warning if compilation takes > 8 minutes
			issues = append(issues, fmt.Sprintf("Long-running compilation: %s (%.1f min)", comp.RequestID[:8], duration.Minutes()))
		}
	}
	activeCompMutex.RUnlock()

	return stats, issues
}

type memoryInfo struct {
	total     uint64
	available uint64
	used      uint64
}

func getSystemMemory() (*memoryInfo, error) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return nil, err
	}
	defer file.Close()

	mem := &memoryInfo{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		value *= 1024 // Convert from KB to bytes

		switch fields[0] {
		case "MemTotal:":
			mem.total = value
		case "MemAvailable:":
			mem.available = value
		}
	}

	mem.used = mem.total - mem.available
	return mem, nil
}

func getCPUPercent() (float64, error) {
	cpuMutex.Lock()
	defer cpuMutex.Unlock()

	current, err := readCPUStats()
	if err != nil {
		return 0, err
	}

	// First call - initialize and return 0
	if lastCPUTime.IsZero() {
		lastCPUStats = current
		lastCPUTime = time.Now()
		return 0, nil
	}

	// Calculate delta
	userDelta := current.user - lastCPUStats.user
	niceDelta := current.nice - lastCPUStats.nice
	systemDelta := current.system - lastCPUStats.system
	idleDelta := current.idle - lastCPUStats.idle
	iowaitDelta := current.iowait - lastCPUStats.iowait
	irqDelta := current.irq - lastCPUStats.irq
	softirqDelta := current.softirq - lastCPUStats.softirq

	totalDelta := userDelta + niceDelta + systemDelta + idleDelta + iowaitDelta + irqDelta + softirqDelta
	if totalDelta == 0 {
		return 0, nil
	}

	cpuPercent := 100.0 * float64(totalDelta-idleDelta) / float64(totalDelta)

	// Update last stats
	lastCPUStats = current
	lastCPUTime = time.Now()

	return cpuPercent, nil
}

func readCPUStats() (cpuStats, error) {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return cpuStats{}, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "cpu ") {
			fields := strings.Fields(line)
			if len(fields) < 8 {
				return cpuStats{}, fmt.Errorf("unexpected /proc/stat format")
			}

			var stats cpuStats
			stats.user, _ = strconv.ParseUint(fields[1], 10, 64)
			stats.nice, _ = strconv.ParseUint(fields[2], 10, 64)
			stats.system, _ = strconv.ParseUint(fields[3], 10, 64)
			stats.idle, _ = strconv.ParseUint(fields[4], 10, 64)
			stats.iowait, _ = strconv.ParseUint(fields[5], 10, 64)
			stats.irq, _ = strconv.ParseUint(fields[6], 10, 64)
			stats.softirq, _ = strconv.ParseUint(fields[7], 10, 64)
			return stats, nil
		}
	}

	return cpuStats{}, fmt.Errorf("/proc/stat: cpu line not found")
}

// detectStuckProcesses finds latex processes running longer than expected
func detectStuckProcesses() []StuckProcess {
	var stuck []StuckProcess

	// Read /proc to find latex-related processes
	procDir, err := os.Open("/proc")
	if err != nil {
		return stuck
	}
	defer procDir.Close()

	entries, err := procDir.Readdirnames(-1)
	if err != nil {
		return stuck
	}

	for _, entry := range entries {
		// Skip non-numeric entries (non-PID directories)
		pid, err := strconv.Atoi(entry)
		if err != nil {
			continue
		}

		// Skip PID 1 (container init process - always running)
		if pid == 1 {
			continue
		}

		// Read command line
		cmdline, err := os.ReadFile(filepath.Join("/proc", entry, "cmdline"))
		if err != nil {
			continue
		}

		cmd := strings.ReplaceAll(string(cmdline), "\x00", " ")
		cmd = strings.TrimSpace(cmd)

		// Check if it's a latex-related process
		if !isLatexProcess(cmd) {
			continue
		}

		// Get process start time
		stat, err := os.ReadFile(filepath.Join("/proc", entry, "stat"))
		if err != nil {
			continue
		}

		startTime, cpuPercent := parseProcessStat(string(stat))
		if startTime.IsZero() {
			continue
		}

		runningFor := time.Since(startTime)

		// Consider stuck if running for more than 12 minutes (timeout is 10 min + buffer)
		if runningFor > 12*time.Minute {
			// Truncate command for display
			displayCmd := cmd
			if len(displayCmd) > 50 {
				displayCmd = displayCmd[:50] + "..."
			}

			stuck = append(stuck, StuckProcess{
				PID:        pid,
				Command:    displayCmd,
				RunningFor: formatDuration(runningFor),
				CPUPercent: cpuPercent,
			})
		}
	}

	return stuck
}

func isLatexProcess(cmd string) bool {
	latexCommands := []string{"pdflatex", "xelatex", "lualatex", "latex", "bibtex", "biber", "latexmk"}
	cmdLower := strings.ToLower(cmd)
	for _, lc := range latexCommands {
		if strings.Contains(cmdLower, lc) {
			return true
		}
	}
	return false
}

func parseProcessStat(stat string) (time.Time, float64) {
	// Format: pid (comm) state ppid pgrp session tty_nr tpgid flags minflt cminflt majflt cmajflt utime stime cutime cstime priority nice num_threads itrealvalue starttime ...
	// starttime is field 22 (0-indexed: 21) - measured in clock ticks since boot

	// Find the closing paren of the command name
	closeParenIdx := strings.LastIndex(stat, ")")
	if closeParenIdx == -1 {
		return time.Time{}, 0
	}

	fields := strings.Fields(stat[closeParenIdx+1:])
	if len(fields) < 20 {
		return time.Time{}, 0
	}

	// utime (field 14) and stime (field 15) for CPU calculation
	// starttime is field 22, but relative to fields after ")" it's index 19
	startTicks, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil {
		return time.Time{}, 0
	}

	// Get system boot time
	bootTime := getBootTime()
	if bootTime.IsZero() {
		return time.Time{}, 0
	}

	// Clock ticks per second (usually 100 on Linux)
	clkTck := uint64(100)

	startTime := bootTime.Add(time.Duration(startTicks/clkTck) * time.Second)

	return startTime, 0 // CPU percent would require sampling over time
}

var bootTimeCache time.Time
var bootTimeOnce sync.Once

func getBootTime() time.Time {
	bootTimeOnce.Do(func() {
		data, err := os.ReadFile("/proc/stat")
		if err != nil {
			return
		}

		scanner := bufio.NewScanner(strings.NewReader(string(data)))
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "btime ") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					btime, err := strconv.ParseInt(fields[1], 10, 64)
					if err == nil {
						bootTimeCache = time.Unix(btime, 0)
					}
				}
				break
			}
		}
	})
	return bootTimeCache
}

func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%.0fs", d.Seconds())
	}
	if d < time.Hour {
		return fmt.Sprintf("%.1fm", d.Minutes())
	}
	return fmt.Sprintf("%.1fh", d.Hours())
}
