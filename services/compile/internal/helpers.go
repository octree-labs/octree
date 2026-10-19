package internal

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// truncateText truncates text to the last maxChars characters
func truncateText(text string, maxChars int) string {
	if len(text) <= maxChars {
		return text
	}
	return text[len(text)-maxChars:]
}

// tailLines returns the last maxLines lines from text
func tailLines(text string, maxLines int) string {
	if text == "" {
		return ""
	}
	lines := strings.Split(text, "\n")
	if len(lines) <= maxLines {
		return text
	}
	return strings.Join(lines[len(lines)-maxLines:], "\n")
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

type bibliographyTool int

const (
	bibliographyToolNone bibliographyTool = iota
	bibliographyToolBibtex
	bibliographyToolBiber
)

func (t bibliographyTool) String() string {
	switch t {
	case bibliographyToolBibtex:
		return "bibtex"
	case bibliographyToolBiber:
		return "biber"
	default:
		return "none"
	}
}

// needsBibliography checks if content requires bibliography processing
func needsBibliography(content string, files []FileEntry) bool {
	// Check for .bib files in the files array
	for _, file := range files {
		if strings.HasSuffix(file.Path, ".bib") {
			return true
		}
	}

	// Check for bibliography commands in content
	bibCommands := []string{
		"\\bibliography{",
		"\\addbibresource{",
		"\\cite{",
		"\\citep{",
		"\\citet{",
		"\\nocite{",
	}

	for _, cmd := range bibCommands {
		if strings.Contains(content, cmd) {
			return true
		}
	}

	return false
}

func detectBibliographyTool(mainContent string, files []FileEntry) bibliographyTool {
	contentsToScan := []string{mainContent}

	for _, file := range files {
		if file.Encoding == "base64" {
			continue
		}
		if !strings.HasSuffix(file.Path, ".tex") && !strings.HasSuffix(file.Path, ".sty") && !strings.HasSuffix(file.Path, ".cls") {
			continue
		}
		contentsToScan = append(contentsToScan, file.Content)
	}

	seenBiblatex := false

	for _, content := range contentsToScan {
		lower := strings.ToLower(content)

		switch {
		case strings.Contains(lower, "backend=bibtex") || strings.Contains(lower, "backend = bibtex"):
			return bibliographyToolBibtex
		case strings.Contains(lower, "backend=biber") || strings.Contains(lower, "backend = biber"):
			seenBiblatex = true
		case strings.Contains(lower, "\\usepackage{biblatex}") ||
			(strings.Contains(lower, "\\usepackage[") && strings.Contains(lower, "{biblatex}")) ||
			strings.Contains(lower, "\\requirepackage{biblatex}") ||
			(strings.Contains(lower, "\\requirepackage[") && strings.Contains(lower, "{biblatex}")):
			seenBiblatex = true
		case strings.Contains(lower, "\\addbibresource") ||
			strings.Contains(lower, "\\printbibliography") ||
			strings.Contains(lower, "\\executebibliographyoptions"):
			seenBiblatex = true
		}
	}

	if seenBiblatex {
		return bibliographyToolBiber
	}

	return bibliographyToolBibtex
}

// needsMultiplePasses checks if content requires multiple compilation passes
func needsMultiplePasses(content string) bool {
	// Check for cross-reference commands
	refCommands := []string{
		"\\ref{",
		"\\pageref{",
		"\\eqref{",
		"\\label{",
		"\\tableofcontents",
		"\\listoffigures",
		"\\listoftables",
	}

	for _, cmd := range refCommands {
		if strings.Contains(content, cmd) {
			return true
		}
	}

	return false
}

// createFileStructure writes all files to the temp directory, preserving directory structure
// Handles both text files and binary files (encoded as base64)
func createFileStructure(tempDir string, files []FileEntry) error {
	for _, file := range files {
		fullPath := filepath.Join(tempDir, file.Path)

		// Create directory if needed
		dir := filepath.Dir(fullPath)
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %v", dir, err)
		}

		// Handle binary files encoded as base64
		if file.Encoding == "base64" {
			decoded, err := base64.StdEncoding.DecodeString(file.Content)
			if err != nil {
				return fmt.Errorf("failed to decode base64 file %s: %v", file.Path, err)
			}
			if err := os.WriteFile(fullPath, decoded, 0644); err != nil {
				return fmt.Errorf("failed to write binary file %s: %v", file.Path, err)
			}
		} else {
			// Text file
			if err := os.WriteFile(fullPath, []byte(file.Content), 0644); err != nil {
				return fmt.Errorf("failed to write text file %s: %v", file.Path, err)
			}
		}
	}

	return nil
}

// FileChanges represents changes between file sets
type FileChanges struct {
	Added           []FileEntry
	Modified        []FileEntry
	Deleted         []string // Just the paths
	HasTexChanges   bool
	HasBibChanges   bool
	HasAssetChanges bool
}

// diffFiles compares current files with cached file hashes and returns changes
func diffFiles(currentFiles []FileEntry, cachedHashes map[string]string) *FileChanges {
	changes := &FileChanges{
		Added:    []FileEntry{},
		Modified: []FileEntry{},
		Deleted:  []string{},
	}

	// Track which cached files we've seen
	seen := make(map[string]bool)

	// Check for added and modified files
	for _, file := range currentFiles {
		seen[file.Path] = true
		currentHash := HashFileContent(file.Content)

		if cachedHash, exists := cachedHashes[file.Path]; exists {
			// File exists in cache
			if currentHash != cachedHash {
				changes.Modified = append(changes.Modified, file)
				categorizeFileChange(file.Path, changes)
			}
		} else {
			// New file
			changes.Added = append(changes.Added, file)
			categorizeFileChange(file.Path, changes)
		}
	}

	// Check for deleted files
	for path := range cachedHashes {
		if !seen[path] {
			changes.Deleted = append(changes.Deleted, path)
			categorizeFileChange(path, changes)
		}
	}

	return changes
}

// categorizeFileChange updates the change flags based on file extension
func categorizeFileChange(path string, changes *FileChanges) {
	if strings.HasSuffix(path, ".tex") || strings.HasSuffix(path, ".sty") || strings.HasSuffix(path, ".cls") {
		changes.HasTexChanges = true
	} else if strings.HasSuffix(path, ".bib") {
		changes.HasBibChanges = true
	} else {
		// Images, data files, etc.
		changes.HasAssetChanges = true
	}
}

// buildFileHashMap creates a map of file path to content hash
func buildFileHashMap(files []FileEntry) map[string]string {
	hashes := make(map[string]string)
	for _, file := range files {
		hashes[file.Path] = HashFileContent(file.Content)
	}
	return hashes
}

// Shell escape policy
//
// `\write18` (and LuaTeX's os.execute) hands the document a shell on the
// compile host. The service used to turn on full `-shell-escape` whenever a
// document loaded minted/pythontex -- and, through a broken string
// comparison, whenever it contained a bare `\usepackage[`, i.e. almost
// always. Nothing in the product needs it: the generate prompt tells the
// model not to use shell-escape packages, the tools templates do not use
// minted, and pythontex/gnuplottex were never advertised.
//
// Policy now:
//   - every engine run gets `-no-shell-escape`;
//   - documents that need EPS conversion get `-shell-restricted` instead,
//     TeX Live's allowlisted mode, with the allowlist narrowed to repstopdf
//     (see restrictedShellEscapeCommands) so pdflatex can still turn
//     `\includegraphics{figure.eps}` into a PDF;
//   - minted, pythontex and friends are refused up front with a clear error.
//     minted needs `pygmentize`, which restricted mode does not allow, so the
//     only way to support it would be full shell escape. Not worth it.

const (
	shellEscapeFlagDisabled   = "-no-shell-escape"
	shellEscapeFlagRestricted = "-shell-restricted"
)

// restrictedShellEscapeCommands replaces texmf.cnf's shell_escape_commands
// (kpathsea lets the environment override it). repstopdf is the restricted
// epstopdf wrapper the graphics drivers call for .eps figures.
const restrictedShellEscapeCommands = "repstopdf"

// shellEscapePackages need `\write18` for anything useful. Loading one is a
// hard error (see unsupportedShellEscapeFeature) rather than a silent
// fallback, because under -no-shell-escape they fail in confusing ways.
var shellEscapePackages = map[string]string{
	"minted":       "minted",
	"pythontex":    "pythontex",
	"gnuplottex":   "gnuplottex",
	"svg":          "svg",
	"auto-pst-pdf": "auto-pst-pdf",
}

// shellEscapeMacros are environments/commands of those packages, caught even
// when the package is loaded from a file we are not inspecting.
var shellEscapeMacros = []struct{ needle, feature string }{
	{`\begin{minted}`, "minted"},
	{`\inputminted`, "minted"},
	{`\begin{pycode}`, "pythontex"},
	{`\begin{pyblock}`, "pythontex"},
	{`\begin{pyconsole}`, "pythontex"},
	{`\begin{gnuplot}`, "gnuplottex"},
	{`\includesvg`, "svg"},
}

var packageLoadPattern = regexp.MustCompile(`\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}`)

// stripTeXComments drops everything from an unescaped % to the end of each
// line, so a commented-out `% \usepackage{minted}` does not count.
func stripTeXComments(content string) string {
	if !strings.Contains(content, "%") {
		return content
	}
	var b strings.Builder
	b.Grow(len(content))
	escaped := false
	skipping := false
	for i := 0; i < len(content); i++ {
		ch := content[i]
		switch {
		case ch == '\n':
			skipping = false
			escaped = false
			b.WriteByte(ch)
		case skipping:
			// drop
		case ch == '\\' && !escaped:
			escaped = true
			b.WriteByte(ch)
		case ch == '%' && !escaped:
			skipping = true
		default:
			escaped = false
			b.WriteByte(ch)
		}
	}
	return b.String()
}

// texSources returns the comment-stripped text of every TeX-like file in the
// request (main file first), which is what the policy checks scan.
func texSources(mainContent string, files []FileEntry) []string {
	sources := make([]string, 0, len(files)+1)
	if mainContent != "" {
		sources = append(sources, stripTeXComments(mainContent))
	}
	for _, file := range files {
		if file.Encoding == "base64" || file.Content == "" {
			continue
		}
		if !shouldInspectForEngine(file.Path) {
			continue
		}
		if file.Content == mainContent {
			continue
		}
		sources = append(sources, stripTeXComments(file.Content))
	}
	return sources
}

// unsupportedShellEscapeFeature returns the name of the first package or
// macro in the sources that cannot work without full shell escape, or "".
func unsupportedShellEscapeFeature(sources []string) string {
	for _, content := range sources {
		for _, match := range packageLoadPattern.FindAllStringSubmatch(content, -1) {
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

// needsEPSConversion reports whether the project includes EPS/PS graphics
// (or loads epstopdf explicitly), the one case that needs the restricted
// shell escape allowlist.
func needsEPSConversion(files []FileEntry, sources []string) (bool, string) {
	for _, file := range files {
		lower := strings.ToLower(file.Path)
		if strings.HasSuffix(lower, ".eps") || strings.HasSuffix(lower, ".ps") {
			return true, file.Path
		}
	}
	for _, content := range sources {
		lower := strings.ToLower(content)
		if strings.Contains(lower, ".eps") {
			return true, ".eps reference"
		}
		for _, match := range packageLoadPattern.FindAllStringSubmatch(content, -1) {
			for _, pkg := range strings.Split(match[1], ",") {
				if strings.TrimSpace(strings.ToLower(pkg)) == "epstopdf" {
					return true, "epstopdf package"
				}
			}
		}
	}
	return false, ""
}

// shellEscapeFlag picks the engine flag for this project and says why.
func shellEscapeFlag(files []FileEntry, sources []string) (string, string) {
	if ok, reason := needsEPSConversion(files, sources); ok {
		return shellEscapeFlagRestricted, reason
	}
	return shellEscapeFlagDisabled, ""
}

// validateFilePath rejects paths that would escape the project workspace.
// Paths are joined onto a per-project temp directory, so "../" or an
// absolute path would let a request write anywhere the service can.
func validateFilePath(path string) error {
	switch {
	case path == "":
		return fmt.Errorf("file path must not be empty")
	case len(path) > 512:
		return fmt.Errorf("file path too long")
	case strings.ContainsRune(path, 0):
		return fmt.Errorf("file path contains a NUL byte")
	case strings.HasPrefix(path, "/") || strings.HasPrefix(path, "\\") || filepath.IsAbs(path):
		return fmt.Errorf("file path must be relative: %q", path)
	}
	cleaned := filepath.Clean(filepath.FromSlash(path))
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return fmt.Errorf("file path escapes the project directory: %q", path)
	}
	return nil
}

// updateCachedFiles writes only changed files to the temp directory
func updateCachedFiles(tempDir string, changes *FileChanges) error {
	// Write added files
	for _, file := range changes.Added {
		if err := writeFile(tempDir, file); err != nil {
			return err
		}
	}

	// Write modified files
	for _, file := range changes.Modified {
		if err := writeFile(tempDir, file); err != nil {
			return err
		}
	}

	// Delete removed files
	for _, path := range changes.Deleted {
		fullPath := filepath.Join(tempDir, path)
		if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("failed to delete file %s: %v", path, err)
		}
	}

	return nil
}

// writeFile writes a single file to the temp directory
func writeFile(tempDir string, file FileEntry) error {
	fullPath := filepath.Join(tempDir, file.Path)

	// Create directory if needed
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %v", dir, err)
	}

	// Handle binary files encoded as base64
	if file.Encoding == "base64" {
		decoded, err := base64.StdEncoding.DecodeString(file.Content)
		if err != nil {
			return fmt.Errorf("failed to decode base64 file %s: %v", file.Path, err)
		}
		if err := os.WriteFile(fullPath, decoded, 0644); err != nil {
			return fmt.Errorf("failed to write binary file %s: %v", file.Path, err)
		}
	} else {
		// Text file
		if err := os.WriteFile(fullPath, []byte(file.Content), 0644); err != nil {
			return fmt.Errorf("failed to write text file %s: %v", file.Path, err)
		}
	}

	return nil
}
