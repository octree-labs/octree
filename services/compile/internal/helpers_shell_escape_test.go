package internal

import "testing"

func TestRequiresShellEscapeDetectsMinted(t *testing.T) {
	files := []FileEntry{
		{
			Path: "main.tex",
			Content: `\documentclass{article}
\usepackage{minted}
\begin{document}
\begin{minted}[fontsize=\small]{python}
print("Hello, world!")
\end{minted}
\end{document}`,
		},
	}

	if !requiresShellEscape(files[0].Content, files) {
		t.Fatalf("expected minted usage to trigger shell escape detection")
	}
}

func TestRequiresShellEscapeDetectsPythonTexTriggers(t *testing.T) {
	files := []FileEntry{
		{
			Path: "chapters/code.tex",
			Content: `\begin{python}
print("ok")
\end{python}`,
		},
	}

	if !requiresShellEscape("", files) {
		t.Fatalf("expected python environment in non-main file to trigger shell escape detection")
	}
}
