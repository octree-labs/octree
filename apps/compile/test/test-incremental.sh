#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

API_BASE_URL=${API_BASE_URL:-http://localhost:3001}
API="$API_BASE_URL/compile"
PROJECT_ID="incremental-test-project"

echo -e "${BLUE}Testing True Incremental Compilation${NC}"
echo ""

# Step 1: Create initial project with multiple files
echo -e "${YELLOW}Step 1: Initial compilation with 3 files${NC}"
time curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\n\\title{Incremental Test}\n\\begin{document}\n\\maketitle\nInitial content.\n\\end{document}"
      },
      {
        "path": "chapter1.tex",
        "content": "\\section{Chapter 1}\nThis is chapter 1."
      },
      {
        "path": "chapter2.tex",
        "content": "\\section{Chapter 2}\nThis is chapter 2."
      }
    ]
  }' \
  --output /tmp/inc1.pdf -s -S 2>&1 | head -3
echo ""
sleep 2

# Step 2: Modify only chapter1.tex
echo -e "${YELLOW}Step 2: Modify only chapter1.tex (incremental)${NC}"
time curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\n\\title{Incremental Test}\n\\begin{document}\n\\maketitle\nInitial content.\n\\end{document}"
      },
      {
        "path": "chapter1.tex",
        "content": "\\section{Chapter 1}\nThis is chapter 1 - MODIFIED!"
      },
      {
        "path": "chapter2.tex",
        "content": "\\section{Chapter 2}\nThis is chapter 2."
      }
    ],
    "lastModifiedFile": "chapter1.tex"
  }' \
  --output /tmp/inc2.pdf -s -S 2>&1 | head -3
echo ""
sleep 2

# Step 3: Same content again (cache hit)
echo -e "${YELLOW}Step 3: Same content (cache hit)${NC}"
time curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\n\\title{Incremental Test}\n\\begin{document}\n\\maketitle\nInitial content.\n\\end{document}"
      },
      {
        "path": "chapter1.tex",
        "content": "\\section{Chapter 1}\nThis is chapter 1 - MODIFIED!"
      },
      {
        "path": "chapter2.tex",
        "content": "\\section{Chapter 2}\nThis is chapter 2."
      }
    ]
  }' \
  --output /tmp/inc3.pdf -s -S 2>&1 | head -3
echo ""

echo -e "${GREEN}✓ Tests complete! Check server logs for incremental compilation details.${NC}"
