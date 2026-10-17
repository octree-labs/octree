package internal

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// RunSynctexForward runs `synctex view` to map a source position to PDF coordinates.
// workDir is the directory where the .synctex.gz and .pdf live (same dir latexmk ran from).
// file is the path relative to tempDir (as sent by the frontend).
func RunSynctexForward(tempDir, workDir, jobName, file string, line, column int) ([]SynctexForwardResult, error) {
	// Convert frontend path (relative to tempDir) to a path relative to workDir
	absFile := filepath.Join(tempDir, filepath.FromSlash(file))
	relFile, err := filepath.Rel(workDir, absFile)
	if err != nil {
		relFile = absFile
	}

	input := fmt.Sprintf("%d:%d:%s", line, column, relFile)
	output := fmt.Sprintf("%s.pdf", jobName)

	cmd := exec.Command("synctex", "view", "-i", input, "-o", output)
	cmd.Dir = workDir

	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("synctex view failed: %w", err)
	}

	return parseForwardOutput(string(out))
}

// RunSynctexReverse runs `synctex edit` to map a PDF position to source coordinates.
// workDir is the directory where the .synctex.gz and .pdf live.
// Returned file paths are relative to tempDir so they match the frontend's file paths.
func RunSynctexReverse(tempDir, workDir, jobName string, page int, h, v float64) ([]SynctexReverseResult, error) {
	output := fmt.Sprintf("%d:%g:%g:%s.pdf", page, h, v, jobName)

	cmd := exec.Command("synctex", "edit", "-o", output)
	cmd.Dir = workDir

	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("synctex edit failed: %w", err)
	}

	return parseReverseOutput(string(out), tempDir)
}

// parseForwardOutput parses the Key:Value output from `synctex view`.
// Example output:
//
//	SyncTeX result begin
//	Output:main.pdf
//	Page:1
//	h:72.26999
//	v:100.50000
//	W:450.00000
//	H:12.00000
//	before:
//	offset:0
//	middle:
//	after:
//	SyncTeX result end
func parseForwardOutput(output string) ([]SynctexForwardResult, error) {
	var results []SynctexForwardResult
	var current *SynctexForwardResult

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if line == "SyncTeX result begin" {
			r := SynctexForwardResult{}
			current = &r
			continue
		}
		if line == "SyncTeX result end" {
			if current != nil {
				results = append(results, *current)
				current = nil
			}
			continue
		}

		if current == nil {
			continue
		}

		key, value := splitSynctexLine(line)
		switch key {
		case "Page":
			current.Page, _ = strconv.Atoi(value)
		case "h":
			current.H, _ = strconv.ParseFloat(value, 64)
		case "v":
			current.V, _ = strconv.ParseFloat(value, 64)
		case "W":
			current.W, _ = strconv.ParseFloat(value, 64)
		case "H":
			current.Height, _ = strconv.ParseFloat(value, 64)
		}
	}

	return results, nil
}

// parseReverseOutput parses the Key:Value output from `synctex edit`.
// Example output:
//
//	SyncTeX result begin
//	Output:main.pdf
//	Input:/tmp/latex-abc123/main.tex
//	Line:42
//	Column:0
//	Offset:0
//	Context:
//	SyncTeX result end
func parseReverseOutput(output, tempDir string) ([]SynctexReverseResult, error) {
	var results []SynctexReverseResult
	var current *SynctexReverseResult

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if line == "SyncTeX result begin" {
			r := SynctexReverseResult{}
			current = &r
			continue
		}
		if line == "SyncTeX result end" {
			if current != nil {
				results = append(results, *current)
				current = nil
			}
			continue
		}

		if current == nil {
			continue
		}

		key, value := splitSynctexLine(line)
		switch key {
		case "Input":
			rel, err := filepath.Rel(tempDir, value)
			if err != nil {
				current.File = value
			} else {
				current.File = rel
			}
		case "Line":
			current.Line, _ = strconv.Atoi(value)
		case "Column":
			current.Column, _ = strconv.Atoi(value)
		}
	}

	return results, nil
}

// splitSynctexLine splits a "Key:Value" line on the first colon.
func splitSynctexLine(line string) (string, string) {
	idx := strings.Index(line, ":")
	if idx < 0 {
		return line, ""
	}
	return line[:idx], line[idx+1:]
}
