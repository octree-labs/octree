#!/bin/bash

# Test script for multi-file LaTeX compilation
# Tests: .tex, .bib, .sty files with subdirectory structure

echo "=== Multi-File Compilation Test ==="
echo "Testing: main.tex + mystyle.sty + references.bib + sections/*.tex"
echo ""

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if files exist
echo "Checking files..."
files=(
    "main.tex"
    "mystyle.sty"
    "references.bib"
    "sections/intro.tex"
    "sections/technical.tex"
    "sections/results.tex"
)

for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✓ $file"
    else
        echo "  ✗ $file (MISSING)"
        exit 1
    fi
done

echo ""
echo "Compiling with pdflatex..."
echo ""

# First pass
pdflatex -interaction=nonstopmode -halt-on-error main.tex
if [ $? -ne 0 ]; then
    echo "❌ First pdflatex pass failed"
    exit 1
fi

# Run bibtex
echo ""
echo "Running bibtex..."
bibtex main
if [ $? -ne 0 ]; then
    echo "❌ BibTeX failed"
    exit 1
fi

# Second pass
echo ""
echo "Running pdflatex (second pass)..."
pdflatex -interaction=nonstopmode -halt-on-error main.tex
if [ $? -ne 0 ]; then
    echo "❌ Second pdflatex pass failed"
    exit 1
fi

# Third pass
echo ""
echo "Running pdflatex (third pass)..."
pdflatex -interaction=nonstopmode -halt-on-error main.tex
if [ $? -ne 0 ]; then
    echo "❌ Third pdflatex pass failed"
    exit 1
fi

# Check if PDF was created
if [ -f "main.pdf" ]; then
    PDF_SIZE=$(stat -f%z main.pdf 2>/dev/null || stat -c%s main.pdf 2>/dev/null)
    echo ""
    echo "✅ SUCCESS! PDF generated: main.pdf ($PDF_SIZE bytes)"
    
    # Clean up auxiliary files
    echo ""
    echo "Cleaning up auxiliary files..."
    rm -f *.aux *.log *.out *.bbl *.blg *.toc
    
    echo "✅ Test completed successfully!"
    exit 0
else
    echo ""
    echo "❌ FAILED: main.pdf was not generated"
    exit 1
fi

