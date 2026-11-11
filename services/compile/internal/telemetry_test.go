package internal

import (
	"strings"
	"testing"
)

func TestClassifyTeXError(t *testing.T) {
	cases := map[string]string{
		"./main.tex:12: Undefined control sequence.":                                "undefined_control_sequence",
		"! LaTeX Error: File `tikz-cd.sty' not found.":                              "missing_package",
		"./main.tex:1: Package fontspec Error: The font \"Amiri\" cannot be found.": "missing_font",
		"! LaTeX Error: File `chapters/ch05.tex' not found.":                        "missing_input",
		"! Missing $ inserted.":                                                     "missing_dollar",
		"! Too many }'s.":                                                           "missing_brace",
		"! Emergency stop.":                                                         "latex_error",
		"":                                                                          "unknown",
	}
	for line, want := range cases {
		if got := classifyTeXError(line); got != want {
			t.Errorf("%q: got %s, want %s", line, got, want)
		}
	}
}

func TestCompileResultPropertiesOnFailure(t *testing.T) {
	full := "This is pdfTeX\n(./main.tex\n./main.tex:3: Undefined control sequence.\nl.3 \\foo\n\n" + strings.Repeat("Overfull \\hbox\n", 200) + "No pages of output.\n"
	res := &CompileResult{
		RequestID: "r1", Success: false, ErrorMessage: "PDF file not generated",
		FullLog: full, LogTail: tailLines(full, 80), Engine: "pdflatex", ExitCode: 12, DurationMs: 1234, QueueMs: 5,
	}
	files := []FileEntry{{Path: "main.tex", Content: "\\documentclass{article}"}, {Path: "a.png", Content: "AAAA", Encoding: "base64"}}
	p := compileResultProperties(res, files, "proj-1", 500)
	if p["error_kind"] != "undefined_control_sequence" {
		t.Fatalf("error_kind = %v", p["error_kind"])
	}
	if p["error_line"] != "./main.tex:3: Undefined control sequence." {
		t.Fatalf("error_line = %v", p["error_line"])
	}
	if ex, _ := p["error_excerpt"].(string); !strings.HasPrefix(ex, "./main.tex:3: Undefined control sequence.\nl.3 \\foo") || len(ex) > ErrorExcerptMax {
		t.Fatalf("error_excerpt = %q", ex)
	}
	if p["files"] != 2 || p["binary_files"] != 1 || p["bytes_in"] != len(files[0].Content)+4 || p["project_id"] != "proj-1" || p["http_status"] != 500 {
		t.Fatalf("counts wrong: %v", p)
	}
	if p["pdf_despite_error"] != false || p["success"] != false || p["engine"] != "pdflatex" || p["exit_code"] != 12 {
		t.Fatalf("result fields wrong: %v", p)
	}
}

func TestCompileResultPropertiesTimeoutAndServiceError(t *testing.T) {
	res := &CompileResult{RequestID: "r2", TimedOut: true, ErrorMessage: "Compilation timed out after 90 seconds", LogTail: "(./main.tex\n[1]"}
	if p := compileResultProperties(res, nil, "", 500); p["error_kind"] != "timeout" {
		t.Fatalf("timeout kind = %v", p["error_kind"])
	}
	res = &CompileResult{RequestID: "r3", ErrorMessage: "Request too large"}
	if p := compileResultProperties(res, nil, "", 413); p["error_kind"] != "service_error" || p["error_message"] != "Request too large" {
		t.Fatalf("service error props = %v", p)
	}
	ok := &CompileResult{RequestID: "r4", Success: true, PDFData: []byte("%PDF"), CacheHit: true, Engine: "xelatex"}
	p := compileResultProperties(ok, nil, "p", 200)
	if _, has := p["error_kind"]; has || p["pdf_bytes"] != 4 || p["cache_hit"] != true {
		t.Fatalf("success props = %v", p)
	}
}

func TestTelemetryCaptureNeverBlocks(t *testing.T) {
	c := newTelemetryClient("k", "http://127.0.0.1:9")
	for i := 0; i < telemetryQueueSize+10; i++ {
		c.Capture("", map[string]interface{}{"i": i})
	}
	if len(c.queue) != telemetryQueueSize {
		t.Fatalf("queue len = %d", len(c.queue))
	}
	var nilClient *telemetryClient
	nilClient.Capture("x", map[string]interface{}{}) // no panic
}
