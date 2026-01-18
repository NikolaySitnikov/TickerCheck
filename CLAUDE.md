# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TickerCheck is a Twitter/X ticker scraper that searches for financial ticker symbols (e.g., $AAPL) on Twitter, retrieves ~20 tweets, and optionally analyzes them with OpenAI's vision API.

**Architecture**: Worker-based queue system with web UI
- **Worker** (`worker.js`): Node.js + Puppeteer connecting to Chrome via remote debugging
- **Frontend** (`website/`): Vanilla JS + Vite, communicates via Supabase realtime
- **Database**: Supabase (PostgreSQL) for job queue and results

## Startup Process

### Automated (Recommended)
```bash
./start.sh
```
This starts Chrome (debug mode), Vite dev server, and worker all at once.

**First time only**: Log into Twitter/X in the Chrome window that opens. Your session persists in `chrome-profile/`.

Open http://localhost:5180/ to use the UI.

### Manual Steps (if needed)

**Step 1: Start Chrome with remote debugging**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-profile"
```

**Step 2: Log into Twitter/X** (only needed once - profile persists)

**Step 3: Start Vite dev server**
```bash
cd website && npx vite --port 5180
```

**Step 4: Start the worker**
```bash
node worker.js
```

**Step 5: Open** http://localhost:5180/

## Common Commands

```bash
# Start dev server (from website/)
npm run dev

# Build for production (from website/)
npm run build

# Start worker (from root)
npm start
# or
node worker.js
```

## Key Files

| File | Purpose |
|------|---------|
| `worker.js` | Puppeteer scraper, Supabase job listener |
| `website/main.js` | Frontend logic, job submission, OpenAI integration |
| `website/index.html` | UI with styles |
| `website/config.js` | OpenAI API key (gitignored) |
| `.env` | Supabase credentials (gitignored) |

## Environment Setup

**.env** (root):
```
SUPABASE_URL=...
SUPABASE_KEY=...
```

**website/config.js**:
```javascript
export const OPENAI_API_KEY = 'sk-...';
```

## Database Schema (Supabase)

**Table: `jobs`**
- `id` - UUID
- `ticker` - Search term (e.g., "$AAPL")
- `status` - "pending" | "processing" | "completed" | "failed"
- `results` - JSONB (tweet array or error)
- `created_at`, `completed_at` - Timestamps

Realtime must be enabled on the `jobs` table.

## Architecture Notes

- Worker connects to Chrome on port 9222, reuses existing x.com tabs
- Scrapes up to 20 tweets with scroll-based pagination (max 15 scrolls)
- Extracts: text, author, timestamp, engagement, images, videos, GIFs
- Frontend subscribes to job updates via Supabase realtime (with polling fallback)
- OpenAI analysis packages tweets with images for vision API

## OpenAI Integration

### Available Models

| Model | Cost (Input/Output per 1M tokens) | Features |
|-------|-----------------------------------|----------|
| GPT-5 Mini | $0.25 / $2 | Fast, affordable |
| GPT-5.2 | $1.75 / $14 | Best vision analysis |
| GPT-5.2 + Web Search | $1.75 / $14 + $0.01/search | Vision + live web data |

### API Implementation

- **Chat Completions API** (`/v1/chat/completions`): Used for GPT-5 Mini and GPT-5.2 (no web search)
- **Responses API** (`/v1/responses`): Used for GPT-5.2 + Web Search with `tools: [{ type: 'web_search' }]`

### Image Handling

- All tweet images are converted to base64 before sending to OpenAI
- Images use `detail: 'high'` mode for chart/graph analysis
- No limit on image count - all images from tweets are included

### Responses API Output Parsing

The Responses API returns an `output` array structure:
```javascript
// Parse output array for text content
for (const item of data.output) {
    if (item.type === 'message' && item.content) {
        for (const contentItem of item.content) {
            if (contentItem.type === 'output_text' && contentItem.text) {
                analysisText += contentItem.text;
            }
        }
    }
}
```

## Frontend Features

- **localStorage Caching**: Search results, ticker, analysis, and prompt persist across page refreshes
- **Auto-expanding Textarea**: Uses `field-sizing: content` CSS property
- **Search History**: Automatically saves tweets + AI analysis when starting new search or clearing
  - Expandable cards with tweet text, images, and "View on Twitter" links
  - Green "Analyzed" badge for entries with AI analysis
  - Max 20 entries, oldest auto-deleted
  - Clear History button to wipe all saved searches
- **Input Clear Button**: Small × inside ticker input field to quickly clear text

## Troubleshooting

### Worker Not Processing Jobs ("Waiting for worker..." stuck)

**Symptoms**: Jobs stay in "pending" status, UI shows "Waiting for worker..." indefinitely, worker process appears to run but produces no output.

**Root Cause**: Corrupted `node_modules`, particularly `puppeteer-core`. This can happen after system updates, interrupted npm installs, or disk issues.

**Solution**:
```bash
# From project root
rm -rf node_modules package-lock.json
npm install
./start.sh
```

### Chrome Window Doesn't Open

**Symptoms**: `start.sh` says "Chrome debug port 9222 is already active" but no Chrome window is visible.

**Root Cause**: A previous Chrome debug process is still running in the background without a visible window.

**Solution**:
```bash
# Find and kill the orphaned Chrome process
lsof -i :9222
kill <PID from above>
./start.sh
```

### Stale Pending Jobs in Database

If there are old "pending" jobs stuck in the database, the worker will try to process them on startup. To clear them:

```bash
# Mark all pending jobs as failed (via Supabase REST API)
curl -X PATCH "https://<your-project>.supabase.co/rest/v1/jobs?status=eq.pending" \
  -H "apikey: <your-key>" \
  -H "Authorization: Bearer <your-key>" \
  -H "Content-Type: application/json" \
  -d '{"status": "failed"}'
```

### Claude Code Cannot Start Services Reliably

**Important**: When using Claude Code to start `./start.sh`, long-running processes may get terminated when the Bash tool times out or is interrupted.

**Best Practice**: Always run `./start.sh` directly in your own terminal, not through Claude Code. Claude Code should only be used for code changes and debugging, not for running persistent services.
