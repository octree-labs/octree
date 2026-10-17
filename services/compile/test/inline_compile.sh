#!/bin/bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 3 ]]; then
  echo "Usage: $0 <project_dir> [compile_url] [output_pdf]" >&2
  echo "Example: $0 test/files/chinese_typography http://localhost:3001/compile chinese.pdf" >&2
  exit 1
fi

PROJECT_DIR="$1"
COMPILE_URL="${2:-http://localhost:3001/compile}"
OUTPUT_PDF="${3:-inline-output.pdf}"

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "❌ Directory '$PROJECT_DIR' not found" >&2
  exit 1
fi

HEADERS_FILE=$(mktemp)
BODY_FILE=$(mktemp)
trap 'rm -f "$HEADERS_FILE" "$BODY_FILE"' EXIT

python3 test/inline_payload.py "$PROJECT_DIR" | \
  curl -sS -D "$HEADERS_FILE" -o "$BODY_FILE" \
    -H "Content-Type: application/json" \
    --data-binary @- \
    "$COMPILE_URL"

HTTP_STATUS=$(awk '/HTTP/{code=$2} END{print code}' "$HEADERS_FILE")

if [[ "$HTTP_STATUS" == "200" ]]; then
  mv "$BODY_FILE" "$OUTPUT_PDF"
  echo "✅ Compilation succeeded (HTTP 200). PDF saved to $OUTPUT_PDF"
else
  echo "❌ Compilation failed (HTTP $HTTP_STATUS). Response body:" >&2
  cat "$BODY_FILE" >&2
  exit 1
fi

