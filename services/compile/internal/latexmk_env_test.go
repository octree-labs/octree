package internal

import (
	"strings"
	"testing"
)

func TestLatexmkEnvDisablesFontGenerationAndScopesInputs(t *testing.T) {
	env := latexmkEnv("/tmp/latex-123")
	want := []string{"MKTEXTFM=0", "MKTEXPK=0", "MKTEXMF=0", "TEXINPUTS=.:/tmp/latex-123:", "openout_any=p"}
	for _, w := range want {
		found := false
		for _, e := range env {
			if e == w {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("expected %q in the latexmk environment, got %s", w, strings.Join(env, " "))
		}
	}
}
