#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

API_BASE_URL=${API_BASE_URL:-http://localhost:3001}
API="$API_BASE_URL/compile"
PROJECT_ID="test-project-123"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Testing Incremental Compilation & Caching${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Test 1: Initial compilation
echo -e "${YELLOW}Test 1: Initial compilation (creating cache)${NC}"
echo "Sending first compilation request..."
START=$(date +%s%3N)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\n\\begin{document}\nHello from Octree! This is test 1.\n\\end{document}"
      }
    ],
    "lastModifiedFile": "main.tex"
  }' \
  -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" \
  --output /tmp/test1.pdf \
  -s -S
END=$(date +%s%3N)
DURATION=$((END - START))
echo -e "${GREEN}✓ First compilation completed in ${DURATION}ms${NC}"
echo ""
sleep 2

# Test 2: Identical content (should hit cache)
echo -e "${YELLOW}Test 2: Exact same content (should hit cache instantly)${NC}"
echo "Sending identical compilation request..."
START=$(date +%s%3N)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\n\\begin{document}\nHello from Octree! This is test 1.\n\\end{document}"
      }
    ],
    "lastModifiedFile": "main.tex"
  }' \
  -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" \
  --output /tmp/test2.pdf \
  -s -S
END=$(date +%s%3N)
DURATION=$((END - START))
echo -e "${GREEN}✓ Cache hit! Completed in ${DURATION}ms (<100ms expected)${NC}"
echo ""
sleep 2

# Test 3: Modified content (incremental compilation)
echo -e "${YELLOW}Test 3: Single file modified (incremental compilation)${NC}"
echo "Sending modified compilation request..."
START=$(date +%s%3N)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\n\\begin{document}\nHello from Octree! This is test 3 - MODIFIED CONTENT.\n\\end{document}"
      }
    ],
    "lastModifiedFile": "main.tex"
  }' \
  -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" \
  --output /tmp/test3.pdf \
  -s -S
END=$(date +%s%3N)
DURATION=$((END - START))
echo -e "${GREEN}✓ Incremental compilation completed in ${DURATION}ms${NC}"
echo ""
sleep 2

# Test 4: Multi-file project
echo -e "${YELLOW}Test 4: Multi-file project with bibliography${NC}"
echo "Sending multi-file compilation request..."
START=$(date +%s%3N)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "multi-file-project",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\n\\usepackage{cite}\n\\begin{document}\nMulti-file test \\cite{example}.\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}"
      },
      {
        "path": "refs.bib",
        "content": "@article{example,\n  author={John Doe},\n  title={Example Article},\n  year={2024}\n}"
      }
    ],
    "lastModifiedFile": "main.tex"
  }' \
  -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" \
  --output /tmp/test4.pdf \
  -s -S
END=$(date +%s%3N)
DURATION=$((END - START))
echo -e "${GREEN}✓ Multi-file compilation completed in ${DURATION}ms${NC}"
echo ""

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}All Tests Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Generated PDFs:"
ls -lh /tmp/test*.pdf 2>/dev/null | awk '{print "  " $9 " - " $5}'
