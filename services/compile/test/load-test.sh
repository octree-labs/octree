#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

API_BASE_URL=${API_BASE_URL:-http://localhost:3001}
API="$API_BASE_URL/compile"
RESULTS_FILE="/tmp/load-test-results-$(date +%s).txt"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   LaTeX Compilation Load Test Suite   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Results will be saved to: $RESULTS_FILE${NC}"
echo ""

# Helper function to make a request and measure time
make_request() {
  local project_id=$1
  local request_num=$2
  local content=$3
  
  # Use curl's built-in timing (cross-platform)
  local temp_file=$(mktemp)
  curl -X POST "$API" \
    -H "Content-Type: application/json" \
    -d "{
      \"projectId\": \"$project_id\",
      \"files\": [
        {
          \"path\": \"main.tex\",
          \"content\": \"$content\"
        }
      ]
    }" \
    --output /tmp/load-test-$project_id-$request_num.pdf \
    -s -w "%{http_code}|%{time_total}" \
    -o /dev/null > "$temp_file" 2>&1
  
  local result=$(cat "$temp_file")
  rm -f "$temp_file"
  
  local http_code=$(echo "$result" | cut -d'|' -f1)
  local time_seconds=$(echo "$result" | cut -d'|' -f2)
  local duration_ms=$(echo "$time_seconds * 1000 / 1" | bc)
  
  echo "$request_num,$duration_ms,$http_code" >> $RESULTS_FILE
  echo "$duration_ms"
}

# Test 1: Sequential baseline
echo -e "${YELLOW}Test 1: Sequential Baseline (10 requests)${NC}"
echo "request,duration_ms,http_code" > $RESULTS_FILE
PROJECT_ID="load-seq-$(date +%s)"

TOTAL_TIME=0
for i in {1..10}; do
  echo -n "  Request $i/10..."
  CONTENT="\\\\documentclass{article}\\\\begin{document}Request $i\\\\end{document}"
  DURATION=$(make_request $PROJECT_ID $i "$CONTENT")
  TOTAL_TIME=$((TOTAL_TIME + DURATION))
  echo -e " ${GREEN}${DURATION}ms${NC}"
done

AVG_SEQUENTIAL=$((TOTAL_TIME / 10))
echo -e "${GREEN}✓ Sequential average: ${AVG_SEQUENTIAL}ms${NC}\n"
sleep 2

# Test 2: Concurrent requests (same project - tests locking)
echo -e "${YELLOW}Test 2: Concurrent Same-Project (10 parallel, same project)${NC}"
echo "Testing cache locking under concurrent load..."
PROJECT_ID="load-concurrent-$(date +%s)"

START=$(date +%s)
for i in {1..10}; do
  (
    CONTENT="\\\\documentclass{article}\\\\begin{document}Concurrent $i\\\\end{document}"
    make_request $PROJECT_ID $i "$CONTENT" > /dev/null
  ) &
done
wait
END=$(date +%s)
CONCURRENT_SAME_TIME=$(( (END - START) * 1000 ))

echo -e "${GREEN}✓ All 10 requests completed in ${CONCURRENT_SAME_TIME}ms${NC}"
echo -e "${CYAN}  (Serial would take ~$((AVG_SEQUENTIAL * 10))ms)${NC}\n"
sleep 2

# Test 3: Concurrent requests (different projects - tests parallelism)
echo -e "${YELLOW}Test 3: Concurrent Different-Projects (20 parallel)${NC}"
echo "Testing true parallelism with different projects..."

START=$(date +%s)
for i in {1..20}; do
  (
    PROJECT_ID="load-parallel-$i-$(date +%s)"
    CONTENT="\\\\documentclass{article}\\\\begin{document}Project $i\\\\end{document}"
    make_request $PROJECT_ID $i "$CONTENT" > /dev/null
  ) &
done
wait
END=$(date +%s)
CONCURRENT_DIFF_TIME=$(( (END - START) * 1000 ))

echo -e "${GREEN}✓ All 20 requests completed in ${CONCURRENT_DIFF_TIME}ms${NC}"
echo -e "${CYAN}  (Serial would take ~$((AVG_SEQUENTIAL * 20))ms)${NC}\n"
sleep 2

# Test 4: Cache hit stress test
echo -e "${YELLOW}Test 4: Cache Hit Performance (100 identical requests)${NC}"
echo "Hammering cache with identical content..."
PROJECT_ID="load-cache-$(date +%s)"
CONTENT="\\\\documentclass{article}\\\\begin{document}Cache test\\\\end{document}"

# First request to populate cache
echo -n "  Populating cache..."
make_request $PROJECT_ID 0 "$CONTENT" > /dev/null
echo -e " ${GREEN}done${NC}"

# Now hammer it
START=$(date +%s)
for i in {1..100}; do
  make_request $PROJECT_ID $i "$CONTENT" > /dev/null &
  # Batch in groups of 10
  if [ $((i % 10)) -eq 0 ]; then
    wait
    echo -n "."
  fi
done
wait
END=$(date +%s)
CACHE_HIT_TIME=$(( (END - START) * 1000 ))
AVG_CACHE_HIT=$((CACHE_HIT_TIME / 100))

echo ""
echo -e "${GREEN}✓ 100 cache hits in ${CACHE_HIT_TIME}ms (avg: ${AVG_CACHE_HIT}ms/request)${NC}\n"
sleep 2

# Test 5: Mixed workload (compilation + cache hits)
echo -e "${YELLOW}Test 5: Mixed Workload (50 requests, 70% cache hits)${NC}"
echo "Simulating realistic usage pattern..."
PROJECT_ID="load-mixed-$(date +%s)"

START=$(date +%s)
for i in {1..50}; do
  if [ $((i % 10)) -lt 7 ]; then
    # Cache hit (70%)
    CONTENT="\\\\documentclass{article}\\\\begin{document}Cached content\\\\end{document}"
  else
    # New compilation (30%)
    CONTENT="\\\\documentclass{article}\\\\begin{document}New content $i\\\\end{document}"
  fi
  make_request $PROJECT_ID $i "$CONTENT" > /dev/null &
  
  if [ $((i % 5)) -eq 0 ]; then
    wait
    echo -n "."
  fi
done
wait
END=$(date +%s)
MIXED_TIME=$(( (END - START) * 1000 ))

echo ""
echo -e "${GREEN}✓ Mixed workload completed in ${MIXED_TIME}ms${NC}\n"
sleep 2

# Test 6: Sustained load over time
echo -e "${YELLOW}Test 6: Sustained Load (30 requests over 30 seconds)${NC}"
echo "Testing steady-state performance..."
PROJECT_ID="load-sustained-$(date +%s)"

START=$(date +%s)
for i in {1..30}; do
  CONTENT="\\\\documentclass{article}\\\\begin{document}Sustained request $i\\\\end{document}"
  make_request $PROJECT_ID $i "$CONTENT" > /dev/null &
  sleep 1
  echo -n "."
done
wait
END=$(date +%s)
SUSTAINED_TIME=$(( (END - START) * 1000 ))

echo ""
echo -e "${GREEN}✓ Sustained load completed in ${SUSTAINED_TIME}ms${NC}\n"
sleep 2

# Test 7: Incremental compilation stress
echo -e "${YELLOW}Test 7: Incremental Compilation (20 sequential edits)${NC}"
echo "Testing incremental performance with file modifications..."
PROJECT_ID="load-incremental-$(date +%s)"

# Initial compilation
CONTENT="\\\\documentclass{article}\\\\begin{document}"
for j in {1..5}; do
  CONTENT="${CONTENT}\\\\section{Section $j}Content $j."
done
CONTENT="${CONTENT}\\\\end{document}"
make_request $PROJECT_ID 0 "$CONTENT" > /dev/null

# Sequential modifications
TOTAL_INCR_TIME=0
for i in {1..20}; do
  SECTION_NUM=$((i % 5 + 1))
  MODIFIED_CONTENT="\\\\documentclass{article}\\\\begin{document}"
  for j in {1..5}; do
    if [ $j -eq $SECTION_NUM ]; then
      MODIFIED_CONTENT="${MODIFIED_CONTENT}\\\\section{Section $j}MODIFIED $i."
    else
      MODIFIED_CONTENT="${MODIFIED_CONTENT}\\\\section{Section $j}Content $j."
    fi
  done
  MODIFIED_CONTENT="${MODIFIED_CONTENT}\\\\end{document}"
  
  DURATION=$(make_request $PROJECT_ID $i "$MODIFIED_CONTENT")
  TOTAL_INCR_TIME=$((TOTAL_INCR_TIME + DURATION))
  echo -n "."
done
AVG_INCR=$((TOTAL_INCR_TIME / 20))

echo ""
echo -e "${GREEN}✓ Incremental average: ${AVG_INCR}ms${NC}\n"

# Generate report
echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Load Test Results              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

cat > /tmp/load-test-report.txt << EOF
LaTeX Compilation Load Test Report
Generated: $(date)
API Endpoint: $API

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERFORMANCE METRICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Sequential Baseline:
  • Average latency: ${AVG_SEQUENTIAL}ms
  • Total for 10 req: ${TOTAL_TIME}ms

Concurrent Same-Project (Locking Test):
  • 10 parallel requests: ${CONCURRENT_SAME_TIME}ms
  • Throughput: $(echo "scale=2; 10000 / $CONCURRENT_SAME_TIME" | bc) req/s

Concurrent Different-Projects:
  • 20 parallel requests: ${CONCURRENT_DIFF_TIME}ms
  • Throughput: $(echo "scale=2; 20000 / $CONCURRENT_DIFF_TIME" | bc) req/s
  • Speedup vs serial: $(echo "scale=2; ($AVG_SEQUENTIAL * 20) / $CONCURRENT_DIFF_TIME" | bc)x

Cache Hit Performance:
  • 100 cache hits: ${CACHE_HIT_TIME}ms
  • Average per hit: ${AVG_CACHE_HIT}ms
  • Cache speedup: $(echo "scale=2; $AVG_SEQUENTIAL / $AVG_CACHE_HIT" | bc)x faster

Mixed Workload (70% cache, 30% compile):
  • 50 requests: ${MIXED_TIME}ms
  • Average: $((MIXED_TIME / 50))ms per request

Sustained Load:
  • 30 requests over 30s: ${SUSTAINED_TIME}ms
  • Average: $((SUSTAINED_TIME / 30))ms per request

Incremental Compilation:
  • 20 sequential edits: ${TOTAL_INCR_TIME}ms
  • Average: ${AVG_INCR}ms per edit

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CACHING EFFECTIVENESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Cache Hit Improvement: $(echo "scale=1; (($AVG_SEQUENTIAL - $AVG_CACHE_HIT) * 100) / $AVG_SEQUENTIAL" | bc)%
Incremental Improvement: $(echo "scale=1; (($AVG_SEQUENTIAL - $AVG_INCR) * 100) / $AVG_SEQUENTIAL" | bc)%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DETAILED RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Raw data saved to: $RESULTS_FILE

EOF

cat /tmp/load-test-report.txt

echo -e "${CYAN}Full report saved to: /tmp/load-test-report.txt${NC}"
echo ""
echo -e "${GREEN}✓ All load tests completed successfully!${NC}"
echo ""

# Cleanup
echo -e "${YELLOW}Cleaning up test PDFs...${NC}"
rm -f /tmp/load-test-*.pdf 2>/dev/null
echo -e "${GREEN}✓ Cleanup complete${NC}"

