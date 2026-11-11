package internal

import (
	"strings"
	"testing"
)

func TestFailureLogPrependsAnEarlyError(t *testing.T) {
	var b strings.Builder
	b.WriteString("This is pdfTeX\n(./main.tex\n")
	b.WriteString("./main.tex:12: Undefined control sequence.\nl.12 \\foo\n\n")
	for i := 0; i < 200; i++ {
		b.WriteString("Overfull \\hbox (3.0pt too wide) in paragraph\n")
	}
	b.WriteString("No pages of output.\n")
	got := failureLog(b.String(), "", "", 80)
	if !strings.HasPrefix(got, "./main.tex:12: Undefined control sequence.\nl.12 \\foo") {
		t.Fatalf("expected the first error at the top, got:\n%s", got[:min(200, len(got))])
	}
	if !strings.Contains(got, "\n[...]\n") || !strings.HasSuffix(got, "No pages of output.\n") {
		t.Fatalf("expected the excerpt, a separator and the tail, got:\n%s", got)
	}
	if lines := strings.Count(got, "\n"); lines > 80+ErrorExcerptLines+2 {
		t.Fatalf("excerpt grew too long: %d lines", lines)
	}
}

func TestFailureLogIsJustTheTailWhenTheErrorIsInIt(t *testing.T) {
	log := "(./main.tex\n! Missing $ inserted.\nl.3 x^2\nNo pages of output.\n"
	if got := failureLog(log, "", "", 80); got != log {
		t.Fatalf("expected the tail unchanged, got:\n%s", got)
	}
}

func TestFailureLogExplainsLatexmkFailuresFromStdout(t *testing.T) {
	log := "(./main.tex)\nOutput written on main.pdf (7 pages).\n"
	stdout := "Latexmk: applying rule 'biber main'...\nRule 'biber main': File changes\nLatexmk: Errors, so I did not complete making targets\n"
	stderr := "biber: error: Cannot find 'refs.bib'\n"
	got := failureLog(log, stdout, stderr, 80)
	if !strings.HasPrefix(got, "Latexmk: Errors, so I did not complete making targets\nbiber: error: Cannot find 'refs.bib'\n[...]\n") {
		t.Fatalf("expected latexmk's error lines first, got:\n%s", got)
	}
	if !strings.HasSuffix(got, log) {
		t.Fatalf("expected the TeX log tail last, got:\n%s", got)
	}
}

func TestFailureLogWithNothingToAdd(t *testing.T) {
	log := "(./main.tex)\nOutput written on main.pdf (7 pages).\n"
	if got := failureLog(log, "Latexmk: all targets are up-to-date", "", 80); got != log {
		t.Fatalf("expected the tail unchanged, got:\n%s", got)
	}
	if got := failureLog("", "Latexmk: Errors, so I did not complete making targets", "", 80); got != "Latexmk: Errors, so I did not complete making targets" {
		t.Fatalf("expected only the tool error, got:\n%s", got)
	}
}
