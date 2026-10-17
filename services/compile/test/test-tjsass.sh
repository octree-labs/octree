#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

API_BASE_URL=${API_BASE_URL:-http://localhost:3001}
API="$API_BASE_URL/compile"
PROJECT_ID="tjsass-test-$(date +%s)"
BASE_DIR="$(cd "$(dirname "$0")" && pwd)/files/Transactions_of_the_Japan_Society_for_Aeronautical_and_Space_Science__TJSASS__Template__1_"

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  TJSASS Template - Real-World Multi-File Test         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Testing with complex academic paper template:${NC}"
echo "  • Custom document class (tjsass.cls)"
echo "  • Custom bibliography style (tjsass.bst)"
echo "  • Citation packages (cite.sty, tjsasscite.sty)"
echo "  • Bibliography database (references.bib)"
echo "  • Images (EPS, PBM, PDF)"
echo "  • Main document (468 lines)"
echo ""

# Helper function to encode file as base64
encode_file() {
  local filepath=$1
  base64 < "$filepath" | tr -d '\n'
}

# Helper function to read text file
read_file() {
  local filepath=$1
  cat "$filepath" | jq -Rs .
}

# Build the complete JSON payload
build_payload() {
  local main_tex_content=$1
  
  cat << EOF
{
  "projectId": "$PROJECT_ID",
  "lastModifiedFile": "main.tex",
  "files": [
    {
      "path": "main.tex",
      "content": $main_tex_content
    },
    {
      "path": "tjsass.cls",
      "content": $(read_file "$BASE_DIR/tjsass.cls")
    },
    {
      "path": "tjsass.bst",
      "content": $(read_file "$BASE_DIR/tjsass.bst")
    },
    {
      "path": "tjsasscite.sty",
      "content": $(read_file "$BASE_DIR/tjsasscite.sty")
    },
    {
      "path": "cite.sty",
      "content": $(read_file "$BASE_DIR/cite.sty")
    },
    {
      "path": "references.bib",
      "content": $(read_file "$BASE_DIR/references.bib")
    },
    {
      "path": "A9R4F83.eps",
      "content": "$(encode_file "$BASE_DIR/A9R4F83.eps")",
      "encoding": "base64"
    },
    {
      "path": "A9R4F83-eps-converted-to.pdf",
      "content": "$(encode_file "$BASE_DIR/A9R4F83-eps-converted-to.pdf")",
      "encoding": "base64"
    }
  ]
}
EOF
}

echo -e "${YELLOW}Test 1: Initial Compilation (Full Bibliography Pipeline)${NC}"
echo "Building complete project payload..."

MAIN_TEX=$(read_file "$BASE_DIR/TJSASS_sample_tex_ver12.tex")
PAYLOAD=$(build_payload "$MAIN_TEX")

echo "Sending compilation request..."
START=$(date +%s)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --output /tmp/tjsass-initial.pdf \
  -s -S -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n"
END=$(date +%s)
INITIAL_TIME=$(( (END - START) * 1000 ))

if [ -f /tmp/tjsass-initial.pdf ]; then
  SIZE=$(ls -lh /tmp/tjsass-initial.pdf | awk '{print $5}')
  echo -e "${GREEN}✓ Initial compilation successful: $SIZE${NC}"
  echo -e "${CYAN}  Compilation time: ${INITIAL_TIME}ms${NC}\n"
else
  echo -e "${RED}✗ Initial compilation failed${NC}\n"
  exit 1
fi

sleep 2

# Test 2: Cache hit (identical content)
echo -e "${YELLOW}Test 2: Cache Hit (Identical Content)${NC}"
echo "Sending identical request..."
START=$(date +%s)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --output /tmp/tjsass-cache-hit.pdf \
  -s -S -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n"
END=$(date +%s)
CACHE_TIME=$(( (END - START) * 1000 ))

if [ -f /tmp/tjsass-cache-hit.pdf ]; then
  SIZE=$(ls -lh /tmp/tjsass-cache-hit.pdf | awk '{print $5}')
  echo -e "${GREEN}✓ Cache hit successful: $SIZE${NC}"
  echo -e "${CYAN}  Cache response time: ${CACHE_TIME}ms${NC}"
  
  if [ $CACHE_TIME -lt 500 ]; then
    SPEEDUP=$(echo "scale=1; $INITIAL_TIME / $CACHE_TIME" | bc)
    echo -e "${GREEN}  🚀 Cache speedup: ${SPEEDUP}x faster!${NC}\n"
  else
    echo -e "${YELLOW}  ⚠ Cache response slower than expected${NC}\n"
  fi
else
  echo -e "${RED}✗ Cache hit failed${NC}\n"
fi

sleep 2

# Test 3: Incremental change (modify text)
echo -e "${YELLOW}Test 3: Incremental Compilation (Modified Text)${NC}"
echo "Modifying document text..."

# Modify the main tex file - change text that actually exists
MODIFIED_TEX=$(cat "$BASE_DIR/TJSASS_sample_tex_ver12.tex" | sed 's/Authors using LaTeX/Authors MODIFIED using LaTeX/g' | jq -Rs .)
MODIFIED_PAYLOAD=$(build_payload "$MODIFIED_TEX")

echo "Sending incremental compilation request..."
START=$(date +%s)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d "$MODIFIED_PAYLOAD" \
  --output /tmp/tjsass-incremental.pdf \
  -s -S -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n"
END=$(date +%s)
INCR_TIME=$(( (END - START) * 1000 ))

if [ -f /tmp/tjsass-incremental.pdf ]; then
  SIZE=$(ls -lh /tmp/tjsass-incremental.pdf | awk '{print $5}')
  echo -e "${GREEN}✓ Incremental compilation successful: $SIZE${NC}"
  echo -e "${CYAN}  Incremental time: ${INCR_TIME}ms${NC}"
  
  IMPROVEMENT=$(echo "scale=1; 100 - ($INCR_TIME * 100 / $INITIAL_TIME)" | bc)
  if [ $(echo "$IMPROVEMENT > 0" | bc) -eq 1 ]; then
    echo -e "${GREEN}  💡 Incremental improvement: ${IMPROVEMENT}% faster${NC}\n"
  else
    echo -e "${CYAN}  Similar performance to initial compilation${NC}\n"
  fi
else
  echo -e "${RED}✗ Incremental compilation failed${NC}\n"
fi

sleep 2

# Test 4: Another cache hit (should reuse incremental compile)
echo -e "${YELLOW}Test 4: Cache Hit After Incremental Change${NC}"
echo "Sending identical incremental request..."
START=$(date +%s)
curl -X POST "$API" \
  -H "Content-Type: application/json" \
  -d "$MODIFIED_PAYLOAD" \
  --output /tmp/tjsass-cache-hit2.pdf \
  -s -S -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n"
END=$(date +%s)
CACHE2_TIME=$(( (END - START) * 1000 ))

if [ -f /tmp/tjsass-cache-hit2.pdf ]; then
  SIZE=$(ls -lh /tmp/tjsass-cache-hit2.pdf | awk '{print $5}')
  echo -e "${GREEN}✓ Second cache hit successful: $SIZE${NC}"
  echo -e "${CYAN}  Cache response time: ${CACHE2_TIME}ms${NC}"
  
  if [ $CACHE2_TIME -lt 500 ]; then
    echo -e "${GREEN}  🎯 Cache working perfectly!${NC}\n"
  fi
else
  echo -e "${RED}✗ Second cache hit failed${NC}\n"
fi

# Summary
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              Test Results Summary                      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Project: TJSASS Academic Paper Template${NC}"
echo -e "${CYAN}Files: 8 files (class, styles, bibliography, images)${NC}"
echo ""
echo "┌─────────────────────────────────────────────┬──────────┐"
echo "│ Test Case                                   │ Time     │"
echo "├─────────────────────────────────────────────┼──────────┤"
printf "│ %-43s │ %6dms │\n" "Initial Compilation" $INITIAL_TIME
printf "│ %-43s │ %6dms │\n" "Cache Hit (identical)" $CACHE_TIME
printf "│ %-43s │ %6dms │\n" "Incremental (text change)" $INCR_TIME
printf "│ %-43s │ %6dms │\n" "Cache Hit (after change)" $CACHE2_TIME
echo "└─────────────────────────────────────────────┴──────────┘"
echo ""

# Calculate improvements
CACHE_IMPROVEMENT=$(echo "scale=1; 100 * ($INITIAL_TIME - $CACHE_TIME) / $INITIAL_TIME" | bc)
echo -e "${GREEN}Cache Improvement: ${CACHE_IMPROVEMENT}%${NC}"

echo ""
echo "Generated PDFs:"
ls -lh /tmp/tjsass*.pdf 2>/dev/null | awk '{print "  " $9 " - " $5}'
echo ""
echo -e "${GREEN}✓ All TJSASS template tests completed!${NC}"

