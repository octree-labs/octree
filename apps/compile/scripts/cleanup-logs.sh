#!/bin/bash

# Cleanup script for LaTeX compilation service logs
# This script removes metadata logs older than specified days

set -e

LOGS_DIR="${LOGS_DIR:-/app/logs}"
KEEP_DAYS="${KEEP_DAYS:-7}"

echo "Cleaning up logs in: $LOGS_DIR"
echo "Keeping logs from last: $KEEP_DAYS days"

if [ ! -d "$LOGS_DIR" ]; then
    echo "Logs directory does not exist: $LOGS_DIR"
    exit 0
fi

# Count files before cleanup
BEFORE=$(find "$LOGS_DIR" -name "*.json" | wc -l)
echo "Total metadata files before cleanup: $BEFORE"

# Remove JSON metadata files older than KEEP_DAYS
DELETED=$(find "$LOGS_DIR" -name "*.json" -type f -mtime +$KEEP_DAYS -delete -print | wc -l)

# Count files after cleanup
AFTER=$(find "$LOGS_DIR" -name "*.json" | wc -l)

echo "Deleted: $DELETED files"
echo "Remaining: $AFTER files"
echo "Cleanup complete!"

