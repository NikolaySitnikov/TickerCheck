#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================"
echo "  TickerCheck - Startup Script"
echo "================================================"
echo ""

# Track if we need to start Chrome (must happen after Vite)
START_CHROME=false

# Check if Chrome is already running with debugging
if lsof -i :9222 > /dev/null 2>&1; then
    echo "[OK] Chrome debug port 9222 is already active"
else
    START_CHROME=true
fi

# Start Vite first (Chrome needs it for localhost:5180)
if lsof -i :5180 > /dev/null 2>&1; then
    echo "[OK] Vite already running on port 5180"
else
    echo "[..] Starting Vite dev server..."
    cd "$SCRIPT_DIR/website" && npx vite --port 5180 > /dev/null 2>&1 &
    cd "$SCRIPT_DIR"
    sleep 2
    echo "[OK] Vite started at http://localhost:5180/"
fi

# Now start Chrome with both tabs
if [ "$START_CHROME" = true ]; then
    echo "[..] Starting Chrome with remote debugging..."
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        --remote-debugging-port=9222 \
        --user-data-dir="$SCRIPT_DIR/chrome-profile" \
        --no-first-run \
        --no-default-browser-check \
        --disable-session-crashed-bubble \
        --disable-infobars \
        "http://localhost:5180" \
        "https://x.com" &
    sleep 3
    echo "[OK] Chrome started with 2 tabs:"
    echo "    - Tab 1: Search panel (localhost:5180)"
    echo "    - Tab 2: Twitter/X (log in if needed)"
    echo ""
    echo "⚠️  If this is your first time, log into Twitter/X!"
    echo "    (Your session will persist for future runs)"
    echo ""
fi

echo ""
echo "[..] Starting worker..."
echo ""
echo "================================================"
echo "  Open http://localhost:5180/ in your browser"
echo "  Worker is running. Press Ctrl+C to stop."
echo "================================================"
echo ""

node worker.js
