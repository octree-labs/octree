package internal

import "testing"

func TestDetectEngine(t *testing.T) {
	cases := []struct {
		name       string
		main       string
		files      []FileEntry
		wantEngine latexEngine
		wantReason string
	}{
		{
			name:       "plain article stays on pdflatex",
			main:       "\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\begin{document}Hi\\end{document}",
			wantEngine: enginePdfLaTeX,
		},
		{
			name:       "fontspec alone",
			main:       "\\documentclass{article}\n\\usepackage{fontspec}\n",
			wantEngine: engineXeLaTeX,
			wantReason: `\usepackage{fontspec}`,
		},
		{
			name:       "fontspec in a comma list",
			main:       "\\usepackage{amsmath,fontspec}\n",
			wantEngine: engineXeLaTeX,
			wantReason: `\usepackage{fontspec}`,
		},
		{
			name:       "whitespace in comma list across lines",
			main:       "\\usepackage{ amsmath ,\n  polyglossia }\n",
			wantEngine: engineXeLaTeX,
			wantReason: `\usepackage{polyglossia}`,
		},
		{
			name:       "xecjk with options",
			main:       "\\usepackage[space,AutoFakeBold]{xeCJK}\n",
			wantEngine: engineXeLaTeX,
			wantReason: `\usepackage{xecjk}`,
		},
		{
			name:       "polyglossia with multi-line options",
			main:       "\\usepackage[\n  verbose,\n  babelshorthands % keep\n]{polyglossia}\n",
			wantEngine: engineXeLaTeX,
			wantReason: `\usepackage{polyglossia}`,
		},
		{
			name:       "package name case differences",
			main:       "\\usepackage{FontSpec}\n",
			wantEngine: engineXeLaTeX,
			wantReason: `\usepackage{fontspec}`,
		},
		{
			name:       "new xe packages",
			main:       "\\usepackage{xltxtra}\n",
			wantEngine: engineXeLaTeX,
			wantReason: `\usepackage{xltxtra}`,
		},
		{
			name:       "fontawesome5 is not a trigger",
			main:       "\\usepackage{fontawesome5}\n",
			wantEngine: enginePdfLaTeX,
		},
		{
			name:       "commented-out package line",
			main:       "\\documentclass{article}\n% \\usepackage{fontspec}\n  %\\setmainfont{Arial}\n",
			wantEngine: enginePdfLaTeX,
		},
		{
			name:       "trigger after a comment on the same line",
			main:       "\\usepackage{amsmath} % \\usepackage{fontspec} \\directlua{}\n",
			wantEngine: enginePdfLaTeX,
		},
		{
			name:       "escaped percent does not start a comment",
			main:       "50\\% of the time \\setmainfont{TeX Gyre Termes}\n",
			wantEngine: engineXeLaTeX,
			wantReason: `\setmainfont`,
		},
		{
			name:       "escaped backslash before percent is a comment",
			main:       "\\\\% \\setmainfont{X}\n",
			wantEngine: enginePdfLaTeX,
		},
		{
			name: "RequirePackage in a class file",
			main: "\\documentclass{mycv}\n\\begin{document}\\end{document}",
			files: []FileEntry{
				{Path: "mycv.cls", Content: "\\NeedsTeXFormat{LaTeX2e}\n\\RequirePackage[no-math]{fontspec}\n"},
			},
			wantEngine: engineXeLaTeX,
			wantReason: `\RequirePackage{fontspec}`,
		},
		{
			name: "RequirePackage of a lua package in a sty file",
			main: "\\documentclass{article}\n\\usepackage{mystyle}\n",
			files: []FileEntry{
				{Path: "mystyle.sty", Content: "\\RequirePackage{luacode}\n"},
			},
			wantEngine: engineLuaLaTeX,
			wantReason: `\RequirePackage{luacode}`,
		},
		{
			name: "non-TeX files are ignored",
			main: "\\documentclass{article}\n",
			files: []FileEntry{
				{Path: "notes.txt", Content: "\\usepackage{fontspec}\n"},
			},
			wantEngine: enginePdfLaTeX,
		},
		{
			name:       "command must be a whole control sequence",
			main:       "\\newcommand{\\setmainfontx}{}\n\\setmainfontx\n\\directluax\n",
			wantEngine: enginePdfLaTeX,
		},
		{
			name:       "command followed by an option bracket",
			main:       "\\setmainfont[Ligatures=TeX]{Libertinus Serif}\n",
			wantEngine: engineXeLaTeX,
			wantReason: `\setmainfont`,
		},
		{
			name:       "command case-insensitive",
			main:       "\\setCJKmainfont{Noto Serif CJK SC}\n",
			wantEngine: engineXeLaTeX,
			wantReason: `\setcjkmainfont`,
		},
		{
			name:       "package name in prose is not a trigger",
			main:       "We do not use fontspec or polyglossia here.\n",
			wantEngine: enginePdfLaTeX,
		},
		{
			// Known limitation: verbatim content is not parsed, so a package
			// load shown inside \verb still triggers. Switching to XeLaTeX
			// for such a document is harmless.
			name:       "verb still triggers (documented limitation)",
			main:       "Write \\verb|\\usepackage{fontspec}| in your preamble.\n",
			wantEngine: engineXeLaTeX,
			wantReason: `\usepackage{fontspec}`,
		},
		{
			name:       "lua takes precedence over xe",
			main:       "\\usepackage{fontspec}\n\\usepackage{luacode}\n",
			wantEngine: engineLuaLaTeX,
			wantReason: `\usepackage{luacode}`,
		},
		{
			name:       "directlua takes precedence over xe",
			main:       "\\usepackage{fontspec}\n\\directlua{tex.print(1)}\n",
			wantEngine: engineLuaLaTeX,
			wantReason: `\directlua`,
		},
		{
			name:       "luacode star environment",
			main:       "\\begin{luacode*}\nprint(1)\n\\end{luacode*}\n",
			wantEngine: engineLuaLaTeX,
			wantReason: `\begin{luacode`,
		},
		{
			name:       "new lua packages",
			main:       "\\usepackage{amsmath, lualatex-math}\n",
			wantEngine: engineLuaLaTeX,
			wantReason: `\usepackage{lualatex-math}`,
		},
		{
			name:       "luatexja (old luatex prefix trigger) still selects lualatex",
			main:       "\\usepackage{luatexja-fontspec}\n",
			wantEngine: engineLuaLaTeX,
			wantReason: `\usepackage{luatexja-fontspec}`,
		},
		{
			name:       "luatexbase selects lualatex",
			main:       "\\RequirePackage{luatexbase}\n",
			wantEngine: engineLuaLaTeX,
			wantReason: `\RequirePackage{luatexbase}`,
		},
		{
			name:       "command at end of input",
			main:       "\\setmainfont",
			wantEngine: engineXeLaTeX,
			wantReason: `\setmainfont`,
		},
		{
			name:       "later whole command after an earlier prefix-only hit",
			main:       "\\setmainfontx \\setmainfont{A}",
			wantEngine: engineXeLaTeX,
			wantReason: `\setmainfont`,
		},
		{
			name:       "ctexart alone stays on pdflatex",
			main:       "\\documentclass{ctexart}\n\\begin{document}中文\\end{document}",
			wantEngine: enginePdfLaTeX,
		},
		{
			name:       "ctexart with xecjk switches",
			main:       "\\documentclass{ctexart}\n\\usepackage{xeCJK}\n",
			wantEngine: engineXeLaTeX,
			wantReason: `\usepackage{xecjk}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &compileSession{mainContent: tc.main, files: tc.files}
			engine, reason := s.detectEngine()
			if engine != tc.wantEngine || reason != tc.wantReason {
				t.Fatalf("got (%s, %q), want (%s, %q)", engine, reason, tc.wantEngine, tc.wantReason)
			}
		})
	}
}

func TestContainsUsepackage(t *testing.T) {
	cases := []struct {
		content string
		pkg     string
		want    bool
	}{
		{`\usepackage{fontspec}`, "fontspec", true},
		{`\usepackage{amsmath,fontspec}`, "fontspec", true},
		{`\usepackage[opt]{ fontspec }`, "FontSpec", true},
		{`\RequirePackage{fontspec}`, "fontspec", true},
		{`\usepackage{fontspecx}`, "fontspec", false},
		{`\usepackage{fontspec}`, "", false},
	}
	for _, tc := range cases {
		if got := containsUsepackage(tc.content, tc.pkg); got != tc.want {
			t.Errorf("containsUsepackage(%q, %q) = %v, want %v", tc.content, tc.pkg, got, tc.want)
		}
	}
}
