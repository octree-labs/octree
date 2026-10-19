package internal

import (
	"strings"
	"testing"
)

func TestShellEscapeDisabledForOrdinaryDocuments(t *testing.T) {
	// The old heuristic turned on full -shell-escape for any `\usepackage[`.
	src := `\documentclass{article}
\usepackage[utf8]{inputenc}
\usepackage[margin=1in]{geometry}
\begin{document}
Hello
\end{document}`
	files := []FileEntry{{Path: "main.tex", Content: src}}
	sources := texSources(src, files)

	if feature := unsupportedShellEscapeFeature(sources); feature != "" {
		t.Fatalf("expected no unsupported feature, got %q", feature)
	}
	flag, reason := shellEscapeFlag(files, sources)
	if flag != shellEscapeFlagDisabled {
		t.Fatalf("expected %s, got %s (%s)", shellEscapeFlagDisabled, flag, reason)
	}
}

func TestWrite18DoesNotEnableShellEscape(t *testing.T) {
	src := `\documentclass{article}\begin{document}\immediate\write18{id}\end{document}`
	files := []FileEntry{{Path: "main.tex", Content: src}}
	flag, _ := shellEscapeFlag(files, texSources(src, files))
	if flag != shellEscapeFlagDisabled {
		t.Fatalf("expected %s, got %s", shellEscapeFlagDisabled, flag)
	}
}

func TestUnsupportedShellEscapeFeatureDetectsPackages(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    string
	}{
		{"minted plain", `\usepackage{minted}`, "minted"},
		{"minted with options", `\usepackage[cache=false]{minted}`, "minted"},
		{"minted in a list", `\usepackage{xcolor, minted,graphicx}`, "minted"},
		{"RequirePackage", `\RequirePackage{minted}`, "minted"},
		{"minted env only", `\begin{minted}{python}\nprint(1)\n\end{minted}`, "minted"},
		{"inputminted", `\inputminted{python}{x.py}`, "minted"},
		{"pythontex package", `\usepackage{pythontex}`, "pythontex"},
		{"pycode env", `\begin{pycode}\nprint(1)\n\end{pycode}`, "pythontex"},
		{"gnuplottex", `\usepackage{gnuplottex}`, "gnuplottex"},
		{"svg", `\usepackage{svg}`, "svg"},
		{"auto-pst-pdf", `\usepackage{auto-pst-pdf}`, "auto-pst-pdf"},
		{"commented out", `% \usepackage{minted}` + "\n" + `\usepackage{listings}`, ""},
		{"word minted in prose", `The coins were minted in 1850.`, ""},
		{"listings", `\usepackage{listings}`, ""},
		{"escaped percent then package", `100\% \usepackage{minted}`, "minted"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := unsupportedShellEscapeFeature([]string{stripTeXComments(tc.content)})
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestUnsupportedShellEscapeFeatureScansIncludedFiles(t *testing.T) {
	files := []FileEntry{
		{Path: "main.tex", Content: `\documentclass{article}\input{chapters/code}`},
		{Path: "chapters/code.tex", Content: `\begin{pycode}` + "\nprint('ok')\n" + `\end{pycode}`},
		{Path: "figure.png", Content: "aGVsbG8=", Encoding: "base64"},
	}
	got := unsupportedShellEscapeFeature(texSources(files[0].Content, files))
	if got != "pythontex" {
		t.Fatalf("expected pythontex from included file, got %q", got)
	}
}

func TestShellEscapeRestrictedOnlyForEPS(t *testing.T) {
	t.Run("eps file in project", func(t *testing.T) {
		src := `\documentclass{article}\usepackage{graphicx}\begin{document}\includegraphics{fig}\end{document}`
		files := []FileEntry{{Path: "main.tex", Content: src}, {Path: "fig.eps", Content: "", Encoding: "base64"}}
		flag, reason := shellEscapeFlag(files, texSources(src, files))
		if flag != shellEscapeFlagRestricted || reason != "fig.eps" {
			t.Fatalf("got %s (%s)", flag, reason)
		}
	})
	t.Run("eps reference in source", func(t *testing.T) {
		src := `\documentclass{article}\usepackage{graphicx}\begin{document}\includegraphics{figures/plot.eps}\end{document}`
		files := []FileEntry{{Path: "main.tex", Content: src}}
		flag, _ := shellEscapeFlag(files, texSources(src, files))
		if flag != shellEscapeFlagRestricted {
			t.Fatalf("got %s", flag)
		}
	})
	t.Run("epstopdf package", func(t *testing.T) {
		src := `\documentclass{article}\usepackage{epstopdf}\begin{document}x\end{document}`
		files := []FileEntry{{Path: "main.tex", Content: src}}
		flag, _ := shellEscapeFlag(files, texSources(src, files))
		if flag != shellEscapeFlagRestricted {
			t.Fatalf("got %s", flag)
		}
	})
	t.Run("png only", func(t *testing.T) {
		src := `\documentclass{article}\usepackage{graphicx}\begin{document}\includegraphics{fig.png}\end{document}`
		files := []FileEntry{{Path: "main.tex", Content: src}, {Path: "fig.png", Content: "aGVsbG8=", Encoding: "base64"}}
		flag, _ := shellEscapeFlag(files, texSources(src, files))
		if flag != shellEscapeFlagDisabled {
			t.Fatalf("got %s", flag)
		}
	})
}

func TestStripTeXComments(t *testing.T) {
	in := "a % comment\nb \\% not a comment % but this is\n\\\\% comment after escaped backslash\nc"
	want := "a \nb \\% not a comment \n\\\\\nc"
	if got := stripTeXComments(in); got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestChildEnvDropsSecrets(t *testing.T) {
	t.Setenv("SUPABASE_JWT_SECRET", "do-not-leak")
	t.Setenv("PATH", "/usr/bin")
	t.Setenv("TEXMFVAR", "/home/compile/.texlive2025/texmf-var")

	env := childEnv("TEXINPUTS=.:/tmp/x:")
	joined := strings.Join(env, "\n")
	if strings.Contains(joined, "SUPABASE_JWT_SECRET") {
		t.Fatalf("secret leaked into child environment: %v", env)
	}
	for _, want := range []string{"PATH=/usr/bin", "TEXMFVAR=/home/compile/.texlive2025/texmf-var", "TEXINPUTS=.:/tmp/x:"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("expected %q in child env %v", want, env)
		}
	}
}

func TestValidateFilePath(t *testing.T) {
	good := []string{"main.tex", "chapters/intro.tex", "./main.tex", "figures/a.b/c.png", "a..b.tex", "..hidden.tex"}
	for _, p := range good {
		if err := validateFilePath(p); err != nil {
			t.Errorf("%q should be accepted: %v", p, err)
		}
	}
	bad := []string{"", ".", "..", "../x.tex", "chapters/../../x.tex", "/etc/passwd", "\\\\server\\share", "a\x00b", strings.Repeat("a", 600)}
	for _, p := range bad {
		if err := validateFilePath(p); err == nil {
			t.Errorf("%q should be rejected", p)
		}
	}
}
