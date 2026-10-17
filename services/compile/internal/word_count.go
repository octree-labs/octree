package internal

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
)

// CountWords counts words in the provided LaTeX files
func CountWords(files []FileEntry) (*WordCountResponse, error) {
	mainFile, _, found := findMainFile(files)
	if !found {
		return nil, fmt.Errorf("no LaTeX source (.tex) file found")
	}

	tempDir, err := os.MkdirTemp("", "wordcount-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp directory: %v", err)
	}
	defer os.RemoveAll(tempDir)

	if err := createFileStructure(tempDir, files); err != nil {
		return nil, fmt.Errorf("failed to write files: %v", err)
	}

	mainFilePath := filepath.Join(tempDir, mainFile.Path)
	return runTexCount(mainFilePath)
}

func runTexCount(mainFilePath string) (*WordCountResponse, error) {
	cmd := exec.Command("texcount", "-inc", "-total", "-brief", mainFilePath)
	output, err := cmd.Output()
	if err != nil {
		cmd = exec.Command("texcount", "-total", "-brief", mainFilePath)
		output, err = cmd.Output()
		if err != nil {
			return nil, fmt.Errorf("texcount failed: %v", err)
		}
	}

	// Parse brief format: "123+45+10 (...) file.tex"
	re := regexp.MustCompile(`(\d+)\+(\d+)\+(\d+)`)
	matches := re.FindStringSubmatch(string(output))
	if matches == nil {
		return nil, fmt.Errorf("unexpected texcount output: %s", string(output))
	}

	text, _ := strconv.Atoi(matches[1])
	headers, _ := strconv.Atoi(matches[2])
	captions, _ := strconv.Atoi(matches[3])

	return &WordCountResponse{
		TextWords:    text,
		HeadersWords: headers,
		CaptionWords: captions,
		Words:        text + headers + captions,
	}, nil
}
