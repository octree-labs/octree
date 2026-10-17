#!/bin/bash

# Test the multifile-complete project using octree-compile service

API_BASE_URL=${API_BASE_URL:-http://localhost:3001}
HEALTH_URL="$API_BASE_URL/health"
COMPILE_URL="$API_BASE_URL/compile"

echo "=== Testing Multi-File Complete Project ==="
echo "Using service: $API_BASE_URL"
echo ""

# Check if octree-compile service is reachable
if ! curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    echo "❌ octree-compile service is not reachable at $API_BASE_URL"
    echo "Set API_BASE_URL to the correct service endpoint before running this test."
    exit 1
fi

echo "✓ octree-compile service is reachable"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/files/multifile-complete"
PAYLOAD_FILE="$(mktemp /tmp/multifile-complete-XXXXXX.json)"
OUTPUT_PDF="/tmp/test-multifile-complete.pdf"

echo "Encoding project..."
if ! python3 "$SCRIPT_DIR/encode_project.py" "$PROJECT_DIR" "$PAYLOAD_FILE"; then
    echo ""
    echo "❌ Failed to encode project files"
    rm -f "$PAYLOAD_FILE"
    exit 1
fi

echo ""
echo "Uploading project to $COMPILE_URL ..."
HTTP_STATUS=$(curl -sS -o "$OUTPUT_PDF" -w "%{http_code}" -X POST "$COMPILE_URL" \
  -H 'Content-Type: application/json' \
  --data-binary "@$PAYLOAD_FILE")

rm -f "$PAYLOAD_FILE"

if [ "$HTTP_STATUS" != "200" ]; then
    echo ""
    echo "❌ Multi-file compilation request failed (HTTP $HTTP_STATUS)"
    rm -f "$OUTPUT_PDF"
    exit 1
fi

echo ""
echo "✅ Multi-file compilation test successful!"
ls -lh "$OUTPUT_PDF"

