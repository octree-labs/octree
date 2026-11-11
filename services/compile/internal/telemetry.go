package internal

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Compile telemetry to PostHog, so what the service saw for a request (engine,
// exit code, duration, the first TeX error, timeouts, cache hits) can be read
// next to the client's `compile_completed` events instead of from the
// droplet's metadata files. Events are queued and sent in batches from one
// goroutine; a full queue drops events rather than slowing a compile.
//
// Configure with POSTHOG_API_KEY (the project token) and POSTHOG_HOST
// (default https://us.i.posthog.com). Unset = telemetry off.

const (
	// CompileServiceEvent is the PostHog event name of one compile request.
	CompileServiceEvent = "compile_service_result"
	telemetryQueueSize  = 512
	telemetryBatchMax   = 50
	telemetryFlushEvery = 5 * time.Second
	// ErrorExcerptMax caps the `error_excerpt` property.
	ErrorExcerptMax = 600
)

type telemetryEvent struct {
	Event      string                 `json:"event"`
	DistinctID string                 `json:"distinct_id"`
	Properties map[string]interface{} `json:"properties"`
	Timestamp  string                 `json:"timestamp"`
}

type telemetryClient struct {
	apiKey string
	host   string
	queue  chan telemetryEvent
	client *http.Client
	once   sync.Once
}

var telemetry *telemetryClient

// InitTelemetry reads POSTHOG_API_KEY / POSTHOG_HOST and starts the sender.
func InitTelemetry() {
	key := strings.TrimSpace(os.Getenv("POSTHOG_API_KEY"))
	if key == "" {
		log.Printf("Telemetry: POSTHOG_API_KEY not set, compile telemetry off")
		return
	}
	host := strings.TrimRight(strings.TrimSpace(os.Getenv("POSTHOG_HOST")), "/")
	if host == "" {
		host = "https://us.i.posthog.com"
	}
	telemetry = newTelemetryClient(key, host)
	go telemetry.run()
	log.Printf("Telemetry: sending %s to %s", CompileServiceEvent, host)
}

func newTelemetryClient(key, host string) *telemetryClient {
	return &telemetryClient{
		apiKey: key,
		host:   host,
		queue:  make(chan telemetryEvent, telemetryQueueSize),
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// Capture queues one event; it never blocks and drops when the queue is full.
func (t *telemetryClient) Capture(distinctID string, props map[string]interface{}) {
	if t == nil {
		return
	}
	if distinctID == "" {
		distinctID = "compile-service"
	}
	props["$lib"] = "octree-compile"
	select {
	case t.queue <- telemetryEvent{
		Event:      CompileServiceEvent,
		DistinctID: distinctID,
		Properties: props,
		Timestamp:  time.Now().UTC().Format(time.RFC3339Nano),
	}:
	default:
		log.Printf("Telemetry: queue full, dropping event")
	}
}

func (t *telemetryClient) run() {
	ticker := time.NewTicker(telemetryFlushEvery)
	defer ticker.Stop()
	batch := make([]telemetryEvent, 0, telemetryBatchMax)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		t.send(batch)
		batch = batch[:0]
	}
	for {
		select {
		case ev := <-t.queue:
			batch = append(batch, ev)
			if len(batch) >= telemetryBatchMax {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func (t *telemetryClient) send(batch []telemetryEvent) {
	body, err := json.Marshal(map[string]interface{}{"api_key": t.apiKey, "batch": batch})
	if err != nil {
		log.Printf("Telemetry: marshal failed: %v", err)
		return
	}
	resp, err := t.client.Post(t.host+"/batch/", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("Telemetry: send failed: %v", err)
		return
	}
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		log.Printf("Telemetry: PostHog answered %d for %d events", resp.StatusCode, len(batch))
	}
}

// --- what one request reports -------------------------------------------

var (
	reUndefinedCS   = regexp.MustCompile(`(?i)undefined control sequence`)
	reMissingFile   = regexp.MustCompile("(?i)file [`'][^']*\\.(sty|cls)' not found")
	reMissingDollar = regexp.MustCompile(`(?i)missing \$ inserted`)
	reMissingBrace  = regexp.MustCompile(`(?i)missing [{}] inserted|too many }'s|extra }, or forgotten`)
	reMissingFont   = regexp.MustCompile(`(?i)fontspec error|font .* cannot be found|cannot find font`)
	reMissingInput  = regexp.MustCompile("(?i)file [`'][^']*' not found|i can't find file")
)

// classifyTeXError mirrors the client's error_kind buckets (lib/analytics/
// compile.ts) for the first error line, with a `missing_font` bucket the
// client folds into latex_error.
func classifyTeXError(line string) string {
	switch {
	case line == "":
		return "unknown"
	case reUndefinedCS.MatchString(line):
		return "undefined_control_sequence"
	case reMissingFile.MatchString(line):
		return "missing_package"
	case reMissingFont.MatchString(line):
		return "missing_font"
	case reMissingInput.MatchString(line):
		return "missing_input"
	case reMissingDollar.MatchString(line):
		return "missing_dollar"
	case reMissingBrace.MatchString(line):
		return "missing_brace"
	default:
		return "latex_error"
	}
}

// firstTeXError returns the first error line of a log and an excerpt of the
// lines that follow it (the `l.<n>` context), capped at ErrorExcerptMax.
func firstTeXError(logContent string) (line, excerpt string) {
	lines := strings.Split(logContent, "\n")
	for i, raw := range lines {
		l := strings.TrimRight(raw, "\r")
		if !texErrorLine(l) {
			continue
		}
		end := min(len(lines), i+ErrorExcerptLines)
		ex := strings.TrimSpace(strings.Join(lines[i:end], "\n"))
		if len(ex) > ErrorExcerptMax {
			ex = ex[:ErrorExcerptMax]
		}
		return l, ex
	}
	return "", ""
}

// compileResultProperties is the property set of one compile_service_result.
func compileResultProperties(result *CompileResult, files []FileEntry, projectID string, status int) map[string]interface{} {
	var bytesIn int
	binary := 0
	for _, f := range files {
		bytesIn += len(f.Content)
		if f.Encoding == "base64" {
			binary++
		}
	}
	props := map[string]interface{}{
		"request_id":   result.RequestID,
		"success":      result.Success,
		"http_status":  status,
		"duration_ms":  result.DurationMs,
		"queue_ms":     result.QueueMs,
		"cache_hit":    result.CacheHit,
		"engine":       result.Engine,
		"exit_code":    result.ExitCode,
		"timed_out":    result.TimedOut,
		"files":        len(files),
		"binary_files": binary,
		"bytes_in":     bytesIn,
		"pdf_bytes":    len(result.PDFData),
	}
	if projectID != "" {
		props["project_id"] = projectID
	}
	if !result.Success {
		props["error_message"] = result.ErrorMessage
		line, excerpt := firstTeXError(result.FullLog)
		if line == "" {
			line, excerpt = firstTeXError(result.LogTail)
		}
		kind := classifyTeXError(line)
		switch {
		case result.TimedOut:
			kind = "timeout"
		case line == "" && result.ErrorMessage != "":
			kind = "service_error"
		}
		props["error_kind"] = kind
		if line != "" {
			props["error_line"] = line
			props["error_excerpt"] = excerpt
		}
		props["pdf_despite_error"] = len(result.PDFData) > 0
	}
	return props
}

// captureCompileResult reports one finished (or refused) compile request.
// clientIP becomes $ip so PostHog resolves the user's country as it does for
// browser events; distinctID is the Supabase user id from the token.
func captureCompileResult(distinctID, clientIP string, props map[string]interface{}) {
	if telemetry == nil {
		return
	}
	if clientIP != "" {
		props["$ip"] = clientIP
	}
	telemetry.Capture(distinctID, props)
}
