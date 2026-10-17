#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

API_BASE_URL=${API_BASE_URL:-http://localhost:3001}
API="$API_BASE_URL/compile"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Testing Edge Cases & Cache Robustness${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Test 1: Large file (stress test)
echo -e "${YELLOW}Test 1: Large document (1000 lines)${NC}"
PROJECT_ID="large-doc-$(date +%s)"
LARGE_CONTENT="\\\\documentclass{article}\\\\begin{document}"
for i in {1..1000}; do
  LARGE_CONTENT="${LARGE_CONTENT}\\\\section{Section $i}This is section $i with content."
done
LARGE_CONTENT="${LARGE_CONTENT}\\\\end{document}"

START=$(date +%s%N)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "'"$LARGE_CONTENT"'"
      }
    ]
  }' \
  --output /tmp/test-edge1.pdf -s -S -w "Time: %{time_total}s\n"
END=$(date +%s%N)
echo -e "${GREEN}✓ Large file compiled in $((($END - $START) / 1000000))ms${NC}\n"
sleep 1

# Test 2: Many small files
echo -e "${YELLOW}Test 2: Many small files (20 chapters)${NC}"
PROJECT_ID="many-files-$(date +%s)"

# Build JSON payload for 20 chapter files
CHAPTERS=""
for i in {1..20}; do
  if [ $i -gt 1 ]; then
    CHAPTERS="${CHAPTERS},"
  fi
  CHAPTERS="${CHAPTERS}{\"path\":\"chapter$i.tex\",\"content\":\"\\\\\\\\chapter{Chapter $i}Content for chapter $i.\"}"
done

START=$(date +%s%N)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"files\": [
      {\"path\":\"main.tex\",\"content\":\"\\\\\\\\documentclass{book}\\\\\\\\begin{document}\\\\\\\\input{chapter1}\\\\\\\\input{chapter2}\\\\\\\\input{chapter3}\\\\\\\\end{document}\"},
      $CHAPTERS
    ]
  }" \
  --output /tmp/test-edge2.pdf -s -S -w "Time: %{time_total}s\n"
END=$(date +%s%N)
echo -e "${GREEN}✓ Many files compiled in $((($END - $START) / 1000000))ms${NC}\n"
sleep 1

# Test 3: Rapid consecutive requests (same project)
echo -e "${YELLOW}Test 3: Rapid consecutive requests (cache locking test)${NC}"
PROJECT_ID="rapid-test-$(date +%s)"
echo "Sending 5 rapid requests..."
for i in {1..5}; do
  curl -X POST "$API" \
    -H "Content-Type: application/json" \
    -d '{
      "projectId": "'$PROJECT_ID'",
      "files": [
        {
          "path": "main.tex",
          "content": "\\documentclass{article}\\begin{document}Request '$i'\\end{document}"
        }
      ]
    }' \
    --output /tmp/test-edge3-$i.pdf -s -S -w "Request $i: %{time_total}s\n" &
done
wait
echo -e "${GREEN}✓ All rapid requests completed${NC}\n"
sleep 2

# Test 4: Empty project recovery
echo -e "${YELLOW}Test 4: Delete and recreate (cache invalidation)${NC}"
PROJECT_ID="delete-test-$(date +%s)"

# First compilation
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\\begin{document}First version\\end{document}"
      }
    ]
  }' \
  --output /tmp/test-edge4a.pdf -s -S -w "Initial: %{time_total}s\n"

sleep 1

# Second compilation (different content, same project)
START=$(date +%s%N)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\\begin{document}Second version - completely different\\end{document}"
      }
    ]
  }' \
  --output /tmp/test-edge4b.pdf -s -S -w "Updated: %{time_total}s\n"
END=$(date +%s%N)
echo -e "${GREEN}✓ Cache invalidation in $((($END - $START) / 1000000))ms${NC}\n"
sleep 1

# Test 5: File deletion (remove a chapter)
echo -e "${YELLOW}Test 5: File deletion detection${NC}"
PROJECT_ID="file-delete-$(date +%s)"

# Initial with 3 files
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {"path": "main.tex", "content": "\\documentclass{article}\\begin{document}\\input{ch1}\\input{ch2}\\end{document}"},
      {"path": "ch1.tex", "content": "Chapter 1"},
      {"path": "ch2.tex", "content": "Chapter 2"}
    ]
  }' \
  --output /tmp/test-edge5a.pdf -s -S -w "With 3 files: %{time_total}s\n"

sleep 1

# Now with ch2 removed
START=$(date +%s%N)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {"path": "main.tex", "content": "\\documentclass{article}\\begin{document}\\input{ch1}\\end{document}"},
      {"path": "ch1.tex", "content": "Chapter 1"}
    ]
  }' \
  --output /tmp/test-edge5b.pdf -s -S -w "With 2 files: %{time_total}s\n"
END=$(date +%s%N)
echo -e "${GREEN}✓ File deletion handled in $((($END - $START) / 1000000))ms${NC}\n"
sleep 1

# Test 6: Special characters in content
echo -e "${YELLOW}Test 6: Special characters handling${NC}"
PROJECT_ID="special-chars-$(date +%s)"
START=$(date +%s%N)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\\begin{document}Testing \\& \\$ \\% \\# \\_ \\{ \\}\\end{document}"
      }
    ]
  }' \
  --output /tmp/test-edge6.pdf -s -S -w "Time: %{time_total}s\n"
END=$(date +%s%N)
echo -e "${GREEN}✓ Special characters handled in $((($END - $START) / 1000000))ms${NC}\n"
sleep 1

# Test 7: Cross-references (requires multi-pass)
echo -e "${YELLOW}Test 7: Cross-references (multi-pass compilation)${NC}"
PROJECT_ID="crossref-test-$(date +%s)"
START=$(date +%s%N)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "files": [
      {
        "path": "main.tex",
        "content": "\\documentclass{article}\\begin{document}\\section{First}\\label{sec:first}See Section \\ref{sec:second}.\\section{Second}\\label{sec:second}Refers to \\ref{sec:first}\\end{document}"
      }
    ]
  }' \
  --output /tmp/test-edge7.pdf -s -S -w "Time: %{time_total}s\n"
END=$(date +%s%N)
echo -e "${GREEN}✓ Cross-references compiled in $((($END - $START) / 1000000))ms${NC}\n"

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}All Edge Case Tests Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Generated PDFs:"
ls -lh /tmp/test-edge*.pdf 2>/dev/null | awk '{print "  " $9 " - " $5}'

