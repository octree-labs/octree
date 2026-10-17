#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

API_BASE_URL=${API_BASE_URL:-http://localhost:3001}
API="$API_BASE_URL/compile"
PROJECT_ID="file-types-test-$(date +%s)"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Testing Different File Types & Caching${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Test 1: .tex file only
echo -e "${YELLOW}Test 1: Single .tex file${NC}"
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\n\\begin{document}\nSimple document.\n\\end{document}"
      }
    ],
    "lastModifiedFile": "main.tex"
  }' \
  --output /tmp/test-type1.pdf -s -S -w "Time: %{time_total}s\n"
echo -e "${GREEN}✓ Completed${NC}\n"
sleep 1

# Test 2: .tex + custom .sty file
echo -e "${YELLOW}Test 2: .tex with custom .sty package${NC}"
PROJECT_ID="sty-test-$(date +%s)"
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\n\\usepackage{mystyle}\n\\begin{document}\n\\mycommand{Hello}\n\\end{document}"
      },
      {
        "path": "mystyle.sty",
        "content": "\\ProvidesPackage{mystyle}\n\\newcommand{\\mycommand}[1]{\\textbf{#1}}"
      }
    ],
    "lastModifiedFile": "main.tex"
  }' \
  --output /tmp/test-type2.pdf -s -S -w "Time: %{time_total}s\n"
echo -e "${GREEN}✓ Completed${NC}\n"
sleep 1

# Test 3: Modify only .sty file (incremental)
echo -e "${YELLOW}Test 3: Modify only .sty file (incremental)${NC}"
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\n\\usepackage{mystyle}\n\\begin{document}\n\\mycommand{Hello}\n\\end{document}"
      },
      {
        "path": "mystyle.sty",
        "content": "\\ProvidesPackage{mystyle}\n\\newcommand{\\mycommand}[1]{\\textit{#1}}"
      }
    ],
    "lastModifiedFile": "mystyle.sty"
  }' \
  --output /tmp/test-type3.pdf -s -S -w "Time: %{time_total}s\n"
echo -e "${GREEN}✓ Completed (incremental)${NC}\n"
sleep 1

# Test 4: Bibliography with .bib file
echo -e "${YELLOW}Test 4: Document with .bib bibliography${NC}"
PROJECT_ID="bib-test-$(date +%s)"
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\n\\begin{document}\nCitation test \\cite{knuth1984}.\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}"
      },
      {
        "path": "refs.bib",
        "content": "@book{knuth1984,\n  author={Donald Knuth},\n  title={The TeXbook},\n  year={1984},\n  publisher={Addison-Wesley}\n}"
      }
    ],
    "lastModifiedFile": "main.tex"
  }' \
  --output /tmp/test-type4.pdf -s -S -w "Time: %{time_total}s\n"
echo -e "${GREEN}✓ Completed${NC}\n"
sleep 1

# Test 5: Modify only .bib file (should use optimized bibtex strategy)
echo -e "${YELLOW}Test 5: Modify only .bib file (optimized bibtex)${NC}"
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\n\\begin{document}\nCitation test \\cite{knuth1984}.\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}"
      },
      {
        "path": "refs.bib",
        "content": "@book{knuth1984,\n  author={Donald E. Knuth},\n  title={The TeXbook (Updated)},\n  year={1984},\n  publisher={Addison-Wesley Publishing}\n}"
      }
    ],
    "lastModifiedFile": "refs.bib"
  }' \
  --output /tmp/test-type5.pdf -s -S -w "Time: %{time_total}s\n"
echo -e "${GREEN}✓ Completed (incremental bib)${NC}\n"
sleep 1

# Test 6: Multi-chapter document
echo -e "${YELLOW}Test 6: Multi-chapter document structure${NC}"
PROJECT_ID="chapters-test-$(date +%s)"
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{book}\n\\begin{document}\n\\input{chapter1}\n\\input{chapter2}\n\\end{document}"
      },
      {
        "path": "chapter1.tex",
        "content": "\\chapter{Introduction}\nThis is the first chapter."
      },
      {
        "path": "chapter2.tex",
        "content": "\\chapter{Methods}\nThis is the second chapter."
      }
    ],
    "lastModifiedFile": "main.tex"
  }' \
  --output /tmp/test-type6.pdf -s -S -w "Time: %{time_total}s\n"
echo -e "${GREEN}✓ Completed${NC}\n"
sleep 1

# Test 7: Modify only one chapter (incremental)
echo -e "${YELLOW}Test 7: Modify only chapter2.tex (incremental)${NC}"
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{book}\n\\begin{document}\n\\input{chapter1}\n\\input{chapter2}\n\\end{document}"
      },
      {
        "path": "chapter1.tex",
        "content": "\\chapter{Introduction}\nThis is the first chapter."
      },
      {
        "path": "chapter2.tex",
        "content": "\\chapter{Methods}\nThis is the second chapter with MODIFICATIONS."
      }
    ],
    "lastModifiedFile": "chapter2.tex"
  }' \
  --output /tmp/test-type7.pdf -s -S -w "Time: %{time_total}s\n"
echo -e "${GREEN}✓ Completed (incremental)${NC}\n"
sleep 1

# Test 8: Same content (cache hit)
echo -e "${YELLOW}Test 8: Identical content (cache hit)${NC}"
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{book}\n\\begin{document}\n\\input{chapter1}\n\\input{chapter2}\n\\end{document}"
      },
      {
        "path": "chapter1.tex",
        "content": "\\chapter{Introduction}\nThis is the first chapter."
      },
      {
        "path": "chapter2.tex",
        "content": "\\chapter{Methods}\nThis is the second chapter with MODIFICATIONS."
      }
    ]
  }' \
  --output /tmp/test-type8.pdf -s -S -w "Time: %{time_total}s (should be <0.2s)\n"
echo -e "${GREEN}✓ Cache hit! Check time above${NC}\n"

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}All File Type Tests Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Generated PDFs:"
ls -lh /tmp/test-type*.pdf 2>/dev/null | awk '{print "  " $9 " - " $5}'

