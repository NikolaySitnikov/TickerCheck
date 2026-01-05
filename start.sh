#!/bin/bash

echo "================================================"
echo "  Twitter Scraper - Startup Script"
echo "================================================"
echo ""

# Check if Chrome is already running with debugging
if lsof -i :9222 > /dev/null 2>&1; then
    echo "[OK] Chrome debug port 9222 is already active"
else
    echo "[..] Starting Chrome with remote debugging..."
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        --remote-debugging-port=9222 \
        --user-data-dir="$SCRIPT_DIR/chrome-profile" \
        --no-first-run \
        --no-default-browser-check \
        --disable-session-crashed-bubble \
        --disable-infobars &
    sleep 3
    echo "[OK] Chrome started"
fi

echo ""
echo "[..] Starting worker..."
echo ""
echo "================================================"
echo "  Worker is running. Press Ctrl+C to stop."
echo "================================================"
echo ""

node worker.js
