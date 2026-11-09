package internal

import (
	"math/rand"
	"regexp"
	"strings"
	"testing"
	"time"
)

// The shell-escape policy shares packageLoadPattern with engine detection.
// These are verbatim copies of the policy functions from before the pattern
// gained a capture group for the command name, so any drift in the security
// decisions shows up here.
var legacyPackageLoadPattern = regexp.MustCompile(`\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}`)

func legacyUnsupportedShellEscapeFeature(sources []string) string {
	for _, content := range sources {
		for _, match := range legacyPackageLoadPattern.FindAllStringSubmatch(content, -1) {
			for _, pkg := range strings.Split(match[1], ",") {
				if feature, ok := shellEscapePackages[strings.ToLower(strings.TrimSpace(pkg))]; ok {
					return feature
				}
			}
		}
		lower := strings.ToLower(content)
		for _, macro := range shellEscapeMacros {
			if strings.Contains(lower, strings.ToLower(macro.needle)) {
				return macro.feature
			}
		}
	}
	return ""
}

func legacyShellEscapeFlag(files []FileEntry, sources []string) (string, string) {
	for _, file := range files {
		lower := strings.ToLower(file.Path)
		if strings.HasSuffix(lower, ".eps") || strings.HasSuffix(lower, ".ps") {
			return shellEscapeFlagRestricted, file.Path
		}
	}
	for _, content := range sources {
		if strings.Contains(strings.ToLower(content), ".eps") {
			return shellEscapeFlagRestricted, ".eps reference"
		}
		for _, match := range legacyPackageLoadPattern.FindAllStringSubmatch(content, -1) {
			for _, pkg := range strings.Split(match[1], ",") {
				if strings.TrimSpace(strings.ToLower(pkg)) == "epstopdf" {
					return shellEscapeFlagRestricted, "epstopdf package"
				}
			}
		}
	}
	return shellEscapeFlagDisabled, ""
}

var shellEscapePolicyCorpus = []string{
	"\\usepackage{minted}",
	"% \\usepackage{minted}",
	"text % \\usepackage{minted}",
	"50\\% \\usepackage{minted}",
	"\\\\% \\usepackage{minted}",
	"\\usepackage[\n  cache=false,\n  outputdir=build\n]{minted}",
	"\\usepackage[cache=false, % note\n]{minted}",
	"\\usepackage{amsmath, minted ,xcolor}",
	"\\usepackage{amsmath,\n  pythontex}",
	"\\RequirePackage{gnuplottex}",
	"\\RequirePackage[opt]{svg}",
	"\\usepackage{MINTED}",
	"\\USEPACKAGE{minted}",
	"\\usepackage {minted}",
	"\\usepackage [x] {minted}",
	"\\usepackage{%\n minted}",
	"\\usepackage{%\n  minted%\n}",
	"\\usepackage{mintedx}",
	"\\usepackage{auto-pst-pdf}",
	"\\begin{minted}{python}x\\end{minted}",
	"\\BEGIN{MINTED}",
	"\\inputminted{c}{a.c}",
	"\\includesvg{fig}",
	"% \\includesvg{fig}",
	"\\begin{pycode}\\end{pycode}",
	"\\immediate\\write18{id > /tmp/x}",
	"\\input{|\"id\"}",
	"\\write18{curl evil}",
	"\\verb|%|\\usepackage{minted}",
	"\\verb|\\usepackage{minted}|",
	"\\begin{verbatim}\n% \\usepackage{minted}\n\\end{verbatim}",
	"\\begin{verbatim}\n\\usepackage{minted}\n\\end{verbatim}",
	"\\includegraphics{fig.eps}",
	"\\includegraphics{fig.EPS}",
	"% \\includegraphics{fig.eps}",
	"\\verb|%|\\includegraphics{fig.eps}",
	"\\usepackage{epstopdf}",
	"\\usepackage{graphicx,EpsToPdf}",
	"\\usepackage[",
	"\\usepackage{",
	"\\usepackage[a]{b}\\usepackage[c]{minted}",
	"\\usepackage[a]{b,\\usepackage{minted}",
	"\\usepackage[a{b]{minted}",
	"\\usepackage[a]b]{minted}",
	"\\usepackage{a}{minted}",
}

func TestShellEscapePolicyUnchangedByPatternRefactor(t *testing.T) {
	check := func(t *testing.T, src string) {
		t.Helper()
		files := []FileEntry{{Path: "main.tex", Content: src}, {Path: "pkg.sty", Content: src + "\n%x"}}
		sources := texSources(src, files)
		if got, want := unsupportedShellEscapeFeature(sources), legacyUnsupportedShellEscapeFeature(sources); got != want {
			t.Fatalf("feature drift for %q: got %q, legacy %q", src, got, want)
		}
		gotFlag, gotWhy := shellEscapeFlag(files, sources)
		wantFlag, wantWhy := legacyShellEscapeFlag(files, sources)
		if gotFlag != wantFlag || gotWhy != wantWhy {
			t.Fatalf("flag drift for %q: got %s/%s, legacy %s/%s", src, gotFlag, gotWhy, wantFlag, wantWhy)
		}
		if gotFlag != shellEscapeFlagDisabled && gotFlag != shellEscapeFlagRestricted {
			t.Fatalf("full shell escape for %q: %s", src, gotFlag)
		}
	}
	for _, src := range shellEscapePolicyCorpus {
		check(t, src)
	}
	// Random splices of the corpus and TeX punctuation.
	frags := append([]string{"%", "\\%", "\\\\", "\n", " ", ",", "[", "]", "{", "}", "minted", "epstopdf", ".eps", "\\usepackage", "\\RequirePackage"}, shellEscapePolicyCorpus...)
	rng := rand.New(rand.NewSource(439))
	for i := 0; i < 20000; i++ {
		var b strings.Builder
		for n := rng.Intn(12); n >= 0; n-- {
			b.WriteString(frags[rng.Intn(len(frags))])
		}
		check(t, b.String())
	}
}

// A comment the stripper drops can only remove a match, never add one, so
// stripping can never turn -no-shell-escape into -shell-restricted.
func TestCommentStrippingNeverLoosensShellFlag(t *testing.T) {
	for _, src := range shellEscapePolicyCorpus {
		stripped, _ := shellEscapeFlag(nil, []string{stripTeXComments(src)})
		raw, _ := shellEscapeFlag(nil, []string{src})
		if stripped == shellEscapeFlagRestricted && raw != shellEscapeFlagRestricted {
			t.Fatalf("stripping loosened flag for %q", src)
		}
	}
}

func pathologicalInputs() map[string]string {
	const size = 2 << 20
	return map[string]string{
		"unclosed options":    strings.Repeat(`\usepackage[`, size/12),
		"unclosed brace":      strings.Repeat(`\usepackage{a,`, size/14),
		"many short packages": strings.Repeat("\\usepackage[x]{a,b}\n", size/20),
		"backslashes":         strings.Repeat(`\`, size),
		"percents":            strings.Repeat("\\%%\n", size/4),
		"command prefixes":    strings.Repeat(`\setmainfon\directlu\begin{luacod`, size/32),
		"whitespace":          `\usepackage` + strings.Repeat(" \n\t", size/3),
	}
}

func TestPolicyAndEngineDetectionAreFastOnPathologicalInput(t *testing.T) {
	for name, src := range pathologicalInputs() {
		start := time.Now()
		sources := texSources(src, nil)
		unsupportedShellEscapeFeature(sources)
		shellEscapeFlag(nil, sources)
		s := &compileSession{mainContent: src}
		s.detectEngine()
		d := time.Since(start)
		t.Logf("%s: %v", name, d)
		if d > time.Second {
			t.Errorf("%s: %v on 2 MB input", name, d)
		}
	}
}

func BenchmarkDetectEngine2MB(b *testing.B) {
	src := strings.Repeat("\\usepackage[x]{a,b} % c\nSome text with \\textbf{bold} and 50\\% off.\n", (2<<20)/70)
	s := &compileSession{mainContent: src}
	b.SetBytes(int64(len(src)))
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		s.detectEngine()
	}
}
