#!/bin/bash
set -euo pipefail

API_BASE_URL=${API_BASE_URL:-http://localhost:3001}
COMPILE_URL="$API_BASE_URL/compile"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/files/multi-no-main"
PAYLOAD_FILE="$(mktemp /tmp/multi-no-main-XXXXXX.json)"
OUTPUT_PDF="/tmp/test-no-main.pdf"

python3 "$SCRIPT_DIR/encode_project.py" "$PROJECT_DIR" "$PAYLOAD_FILE" > /tmp/test-no-main-encode.log

HTTP_STATUS=$(curl -sS -o "$OUTPUT_PDF" -w "%{http_code}" -X POST "$COMPILE_URL" -H 'Content-Type: application/json' --data-binary "@$PAYLOAD_FILE")
rm -f "$PAYLOAD_FILE"

if [ "$HTTP_STATUS" != "200" ]; then
  echo "Test failed: HTTP $HTTP_STATUS"
  cat /tmp/test-no-main-encode.log
  exit 1
fi

ls -lh "$OUTPUT_PDF"
