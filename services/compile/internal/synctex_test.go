package internal

import (
	"testing"
)

func TestSplitSynctexLine(t *testing.T) {
	tests := []struct {
		input     string
		wantKey   string
		wantValue string
	}{
		{"Page:1", "Page", "1"},
		{"h:72.26999", "h", "72.26999"},
		{"Input:/tmp/latex-abc123/main.tex", "Input", "/tmp/latex-abc123/main.tex"},
		{"Output:main.pdf", "Output", "main.pdf"},
		{"nocolon", "nocolon", ""},
		{"Key:", "Key", ""},
		{":value", "", "value"},
	}

	for _, tt := range tests {
		key, value := splitSynctexLine(tt.input)
		if key != tt.wantKey || value != tt.wantValue {
			t.Errorf("splitSynctexLine(%q) = (%q, %q), want (%q, %q)",
				tt.input, key, value, tt.wantKey, tt.wantValue)
		}
	}
}

func TestParseForwardOutput(t *testing.T) {
	output := `SyncTeX result begin
Output:main.pdf
Page:1
h:72.26999
v:100.50000
W:450.00000
H:12.00000
before:
offset:0
middle:
after:
SyncTeX result end
`
	results, err := parseForwardOutput(output)
	if err != nil {
		t.Fatalf("parseForwardOutput returned error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	r := results[0]
	if r.Page != 1 {
		t.Errorf("Page = %d, want 1", r.Page)
	}
	if r.H != 72.26999 {
		t.Errorf("H = %f, want 72.26999", r.H)
	}
	if r.V != 100.5 {
		t.Errorf("V = %f, want 100.5", r.V)
	}
	if r.W != 450.0 {
		t.Errorf("W = %f, want 450.0", r.W)
	}
	if r.Height != 12.0 {
		t.Errorf("Height = %f, want 12.0", r.Height)
	}
}

func TestParseForwardOutputMultipleResults(t *testing.T) {
	output := `SyncTeX result begin
Output:main.pdf
Page:1
h:72.27
v:100.50
W:450.00
H:12.00
before:
offset:0
middle:
after:
SyncTeX result end
SyncTeX result begin
Output:main.pdf
Page:2
h:80.00
v:200.00
W:400.00
H:10.00
before:
offset:0
middle:
after:
SyncTeX result end
`
	results, err := parseForwardOutput(output)
	if err != nil {
		t.Fatalf("parseForwardOutput returned error: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}

	if results[0].Page != 1 || results[1].Page != 2 {
		t.Errorf("expected pages 1 and 2, got %d and %d", results[0].Page, results[1].Page)
	}
}

func TestParseForwardOutputEmpty(t *testing.T) {
	results, err := parseForwardOutput("")
	if err != nil {
		t.Fatalf("parseForwardOutput returned error: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected 0 results, got %d", len(results))
	}
}

func TestParseReverseOutput(t *testing.T) {
	output := `SyncTeX result begin
Output:main.pdf
Input:/tmp/latex-abc123/main.tex
Line:42
Column:0
Offset:0
Context:
SyncTeX result end
`
	results, err := parseReverseOutput(output, "/tmp/latex-abc123")
	if err != nil {
		t.Fatalf("parseReverseOutput returned error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	r := results[0]
	if r.File != "main.tex" {
		t.Errorf("File = %q, want %q", r.File, "main.tex")
	}
	if r.Line != 42 {
		t.Errorf("Line = %d, want 42", r.Line)
	}
	if r.Column != 0 {
		t.Errorf("Column = %d, want 0", r.Column)
	}
}

func TestParseReverseOutputSubdirectory(t *testing.T) {
	output := `SyncTeX result begin
Output:main.pdf
Input:/tmp/latex-abc123/chapters/intro.tex
Line:15
Column:3
Offset:0
Context:
SyncTeX result end
`
	results, err := parseReverseOutput(output, "/tmp/latex-abc123")
	if err != nil {
		t.Fatalf("parseReverseOutput returned error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	if results[0].File != "chapters/intro.tex" {
		t.Errorf("File = %q, want %q", results[0].File, "chapters/intro.tex")
	}
}

func TestParseReverseOutputEmpty(t *testing.T) {
	results, err := parseReverseOutput("", "/tmp/test")
	if err != nil {
		t.Fatalf("parseReverseOutput returned error: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected 0 results, got %d", len(results))
	}
}

// TestParseReverseOutputRelToTempDir verifies that even when synctex reports
// an absolute path, it gets converted to a path relative to tempDir (not workDir),
// matching the file paths the frontend originally sent.
func TestParseReverseOutputRelToTempDir(t *testing.T) {
	// Scenario: main.tex is at src/main.tex, it \input{../shared/macros.tex}
	// synctex reports the absolute path; we want it relative to tempDir.
	output := `SyncTeX result begin
Output:main.pdf
Input:/tmp/latex-abc123/shared/macros.tex
Line:5
Column:0
Offset:0
Context:
SyncTeX result end
`
	// tempDir is the project root; workDir would be /tmp/latex-abc123/src/
	// but parseReverseOutput takes tempDir to produce frontend-matching paths
	results, err := parseReverseOutput(output, "/tmp/latex-abc123")
	if err != nil {
		t.Fatalf("parseReverseOutput returned error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	if results[0].File != "shared/macros.tex" {
		t.Errorf("File = %q, want %q", results[0].File, "shared/macros.tex")
	}
}
