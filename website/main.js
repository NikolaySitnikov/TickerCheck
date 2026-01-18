/**
 * Ticker Scraper - Web Interface
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { OPENAI_API_KEY } from './config.js';

// Fixed analysis prompt - elite crypto trader brief
const ANALYSIS_PROMPT = `You are an elite crypto derivatives trader and technical analyst. Your job is to synthesize social sentiment, chart analysis, and current news into a tight tactical brief. You are known for cutting through noise — not repeating it.

## INPUT
- **Ticker**: e.g., $SOL, $BTC
- **~20 Recent Twitter Posts** (Top Search) with: author, timestamp, text, attached images (usually charts)

## INTERNAL PROCESSING (DO NOT OUTPUT THIS SECTION)
Silently analyze each post for:
- Thesis, directional bias, specific levels (entries/targets/stops)
- Chart timeframes, patterns, indicators, and whether setups are still valid
- Quality filter: real alpha vs. vibes/noise/brag posts/scams
- Temporal relevance: has the setup played out? Is it forward-looking or post-hoc?
- Convergence: are multiple traders piling into the same idea?

Then **use web search** to find: recent news/catalysts, funding rates, OI data, ecosystem developments, and any red flags.

## OUTPUT FORMAT (THIS IS YOUR ENTIRE RESPONSE)

**$[TICKER] BRIEF — [Date/Time]**

**SENTIMENT**: [Bullish/Bearish/Mixed] — [1 sentence max]

**KEY LEVELS** (aggregated from charts):
- Resistance: [levels]
- Support: [levels]
- Invalidation: [level + context]

**SETUPS WORTH WATCHING** (2-4 max, only credible ones):
- [Setup 1: direction, trigger, target, stop — 1 line]
- [Setup 2: ...]

**CATALYSTS / NEWS**: [2-3 sentences max — what's driving this?]

**RED FLAGS**: [Crowded trades, scam links, conflicting signals, data gaps — bullet if needed]

**BOTTOM LINE**: [2-3 sentences: Is there edge? What's the play? What invalidates it?]

---

## CRITICAL RULES
- **DO NOT list or summarize individual tweets.** Synthesize them.
- **DO NOT repeat tweet content back.** Extract the signal, discard the noise.
- If 15 tweets say the same thing, that's ONE data point (consensus), not 15.
- Brevity is mandatory. If you can say it in fewer words, do it.
- If the data is low quality or there's no edge, say so in 1-2 sentences and stop.
- Total response should be under 400 words unless complexity genuinely demands more.`;

// Supabase Configuration
const SUPABASE_URL = 'https://trjqzuojllkmnoyqupib.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyanF6dW9qbGxrbW5veXF1cGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1ODEwMDYsImV4cCI6MjA4MzE1NzAwNn0.9iTi4y_wrYnk7MOu3AS5TLu0V7Cjcp790Po3gIQNd38';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// DOM Elements
const tickerInput = document.getElementById('ticker-input');
const searchBtn = document.getElementById('search-btn');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');
const jsonSection = document.getElementById('json-section');
const jsonToggleBtn = document.getElementById('json-toggle-btn');
const jsonOutput = document.getElementById('json-output');
const copyBtn = document.getElementById('copy-btn');
const clearBtn = document.getElementById('clear-btn');
const modelSelect = document.getElementById('model-select');
const analyzeBtn = document.getElementById('analyze-btn');
const analysisSection = document.getElementById('analysis-section');
const analysisStatus = document.getElementById('analysis-status');
const analysisResults = document.getElementById('analysis-results');
const promptToggle = document.getElementById('prompt-toggle');
const promptContent = document.getElementById('prompt-content');
const promptInput = document.getElementById('prompt-input');
const historySection = document.getElementById('history-section');
const historyCards = document.getElementById('history-cards');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const clearInputBtn = document.getElementById('clear-input-btn');

let currentJobId = null;
let currentResults = null;
let currentTicker = null;
let currentAnalysis = null;
let currentModel = null;

// Restore cached results on page load
restoreCachedResults();

// Handle search button click
searchBtn.addEventListener('click', submitJob);

// Handle clear button click
clearBtn.addEventListener('click', clearResults);

// Handle Enter key
tickerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        submitJob();
    }
});

// Toggle JSON display
jsonToggleBtn.addEventListener('click', () => {
    jsonOutput.classList.toggle('hidden');
    jsonToggleBtn.textContent = jsonOutput.classList.contains('hidden')
        ? 'Show Raw JSON'
        : 'Hide Raw JSON';
});

// Copy JSON to clipboard
copyBtn.addEventListener('click', async () => {
    if (currentResults) {
        await navigator.clipboard.writeText(JSON.stringify(currentResults, null, 2));
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
            copyBtn.textContent = 'Copy JSON';
        }, 2000);
    }
});

// Analyze button click
analyzeBtn.addEventListener('click', analyzeTweets);

// Prompt toggle (collapsible)
promptToggle.addEventListener('click', () => {
    promptToggle.classList.toggle('expanded');
    promptContent.classList.toggle('visible');
});

// Initialize prompt textarea with default prompt
promptInput.value = ANALYSIS_PROMPT;

/**
 * Submit a new scraping job
 */
async function submitJob() {
    let ticker = tickerInput.value.trim();

    if (!ticker) {
        showStatus('Please enter a ticker', 'failed');
        return;
    }

    // Add $ if not present
    if (!ticker.startsWith('$')) {
        ticker = '$' + ticker;
    }

    // Save current results to history before starting new search
    saveToHistory();

    // Disable button and clear previous results completely
    searchBtn.disabled = true;
    resultsDiv.innerHTML = '';
    jsonSection.style.display = 'none';
    jsonOutput.textContent = '';
    jsonOutput.classList.add('hidden');
    jsonToggleBtn.textContent = 'Show Raw JSON';
    currentResults = null;
    currentJobId = null;
    currentTicker = null;
    currentAnalysis = null;
    currentModel = null;
    analyzeBtn.disabled = true;
    analysisSection.style.display = 'none';
    analysisResults.innerHTML = '';
    analysisStatus.className = 'status hidden';

    showStatus(`Submitting job for ${ticker}...`, 'pending');

    try {
        // Insert job into Supabase
        const { data: job, error } = await supabase
            .from('jobs')
            .insert({ ticker })
            .select()
            .single();

        if (error) {
            throw error;
        }

        currentJobId = job.id;
        console.log('Job created:', job.id);

        showStatus(`Job submitted. Waiting for worker...`, 'pending');

        // Subscribe to this job's updates
        subscribeToJob(job.id);

    } catch (error) {
        console.error('Error submitting job:', error);
        showStatus(`Error: ${error.message}`, 'failed');
        searchBtn.disabled = false;
    }
}

/**
 * Subscribe to job updates
 */
function subscribeToJob(jobId) {
    const channel = supabase
        .channel(`job-${jobId}`)
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'jobs',
                filter: `id=eq.${jobId}`
            },
            (payload) => {
                console.log('Job update:', payload.new);
                handleJobUpdate(payload.new);
            }
        )
        .subscribe();

    // Also poll in case we miss the realtime update
    pollJobStatus(jobId);
}

/**
 * Poll for job status (backup for realtime)
 */
async function pollJobStatus(jobId) {
    const maxAttempts = 60; // 60 seconds timeout
    let attempts = 0;

    const poll = async () => {
        attempts++;

        const { data: job, error } = await supabase
            .from('jobs')
            .select('*')
            .eq('id', jobId)
            .single();

        if (error) {
            console.error('Polling error:', error);
            return;
        }

        if (job.status !== 'pending' && job.status !== 'processing') {
            handleJobUpdate(job);
            return;
        }

        if (job.status === 'processing') {
            showStatus('Worker is scraping Twitter...', 'processing');
        }

        if (attempts < maxAttempts) {
            setTimeout(poll, 1000);
        } else {
            showStatus('Timeout waiting for results. Is the worker running?', 'failed');
            searchBtn.disabled = false;
        }
    };

    setTimeout(poll, 1000);
}

/**
 * Handle job status update
 */
function handleJobUpdate(job) {
    if (job.status === 'processing') {
        showStatus('Worker is scraping Twitter...', 'processing');
    }
    else if (job.status === 'completed') {
        showStatus(`Found ${job.results.length} tweets!`, 'completed');
        displayResults(job.results, job.ticker);
        searchBtn.disabled = false;
    }
    else if (job.status === 'failed') {
        showStatus(`Error: ${job.results?.error || 'Unknown error'}`, 'failed');
        searchBtn.disabled = false;
    }
}

/**
 * Show status message
 */
function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
}

/**
 * Display tweet results
 */
function displayResults(tweets, ticker = null) {
    currentResults = tweets;
    if (ticker) {
        currentTicker = ticker;
    }

    // Cache results to localStorage
    if (tweets && tweets.length > 0) {
        localStorage.setItem('cachedResults', JSON.stringify(tweets));
        if (ticker) {
            localStorage.setItem('cachedTicker', ticker);
        }
    }

    if (!tweets || tweets.length === 0) {
        resultsDiv.innerHTML = '<div class="no-results">No tweets found</div>';
        return;
    }

    resultsDiv.innerHTML = tweets.map(tweet => {
        // Build media HTML
        let mediaHtml = '';

        if (tweet.media) {
            // Images
            if (tweet.media.images && tweet.media.images.length > 0) {
                const gridClass = tweet.media.images.length === 1 ? 'tweet-media tweet-media-single' : 'tweet-media';
                mediaHtml += `
                    <div class="${gridClass}">
                        ${tweet.media.images.map(img => `<img src="${escapeHtml(img)}" alt="Tweet image" loading="lazy" onclick="window.open('${escapeHtml(img)}', '_blank')" />`).join('')}
                    </div>
                `;
            }

            // Video: don't display thumbnail, only show tweet text

            // GIFs
            if (tweet.media.gifs && tweet.media.gifs.length > 0) {
                mediaHtml += `
                    <div class="media-label">GIF</div>
                    <div class="tweet-media tweet-media-single">
                        ${tweet.media.gifs.map(gif => `<video src="${escapeHtml(gif)}" autoplay loop muted playsinline style="max-width:100%; border-radius:8px;"></video>`).join('')}
                    </div>
                `;
            }
        }

        return `
            <div class="tweet">
                <div class="tweet-header">
                    <span class="tweet-author">${escapeHtml(tweet.author.displayName)}</span>
                    <span class="tweet-username">${escapeHtml(tweet.author.username)}</span>
                    <span class="tweet-time">${escapeHtml(tweet.relativeTime)}</span>
                </div>
                <div class="tweet-text">${escapeHtml(tweet.text)}</div>
                ${mediaHtml}
                <div class="tweet-engagement">
                    <span>${tweet.engagement.replies}</span>
                    <span>${tweet.engagement.retweets}</span>
                    <span>${tweet.engagement.likes}</span>
                </div>
                ${tweet.url ? `<a href="${escapeHtml(tweet.url)}" target="_blank" class="tweet-link">View on Twitter</a>` : ''}
            </div>
        `;
    }).join('');

    // Show JSON section and enable analyze button
    jsonSection.style.display = 'block';
    jsonOutput.textContent = JSON.stringify(tweets, null, 2);
    analyzeBtn.disabled = false;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Clear all results
 */
function clearResults() {
    // Save current results to history before clearing
    saveToHistory();

    tickerInput.value = '';
    statusDiv.className = 'status hidden';
    resultsDiv.innerHTML = '';
    jsonSection.style.display = 'none';
    jsonOutput.textContent = '';
    jsonOutput.classList.add('hidden');
    jsonToggleBtn.textContent = 'Show Raw JSON';
    currentResults = null;
    currentJobId = null;
    currentTicker = null;
    currentAnalysis = null;
    currentModel = null;
    searchBtn.disabled = false;
    analyzeBtn.disabled = true;
    analysisSection.style.display = 'none';
    analysisResults.innerHTML = '';
    analysisStatus.className = 'status hidden';
    // Clear localStorage cache
    localStorage.removeItem('cachedResults');
    localStorage.removeItem('cachedTicker');
    localStorage.removeItem('cachedAnalysis');
    localStorage.removeItem('cachedModel');
    tickerInput.focus();
}

/**
 * Package tweets for OpenAI analysis (token-optimized)
 */
function packageTweetsForAnalysis(tweets) {
    return tweets.map(tweet => {
        const packaged = {
            author: `${tweet.author.displayName} (@${tweet.author.username})`,
            time: tweet.timestamp,
            text: tweet.text
        };
        // Include images only (skip videos per requirements)
        if (tweet.media?.images?.length > 0) {
            packaged.images = tweet.media.images;
        }
        return packaged;
    });
}

/**
 * Show analysis status message
 */
function showAnalysisStatus(message, type) {
    analysisStatus.textContent = message;
    analysisStatus.className = `status ${type}`;
}

/**
 * Parse markdown text into beautiful HTML
 * @param {string} text - The markdown text to parse
 * @param {object} options - Optional settings (timestamp, model for history entries)
 */
function parseMarkdownToHtml(text, options = {}) {
    if (!text) return '';

    // First escape HTML
    let html = escapeHtml(text);

    // Split into lines for processing
    const lines = html.split('\n');
    const result = [];
    let inList = false;
    let listItems = [];

    const flushList = () => {
        if (listItems.length > 0) {
            result.push(`<ul class="analysis-list">${listItems.join('')}</ul>`);
            listItems = [];
        }
        inList = false;
    };

    // Format timestamp if provided in options
    const formatTimestamp = (ts) => {
        if (!ts) return '';
        const date = new Date(ts);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Skip empty lines but close lists
        if (line.trim() === '') {
            flushList();
            continue;
        }

        // Main title with ticker (e.g., **$SOL BRIEF — 01/08/2026**)
        if (line.match(/^\*\*\$[A-Z0-9]+ BRIEF.*\*\*$/)) {
            flushList();
            // If skipTitle is set, skip rendering the title card (it's rendered externally)
            if (options.skipTitle) {
                continue;
            }
            const title = line.replace(/\*\*/g, '');
            const tickerMatch = title.match(/\$([A-Z0-9]+)/);
            const ticker = tickerMatch ? tickerMatch[1] : '';
            // Use provided timestamp from options, or fall back to the date in the text
            const displayDate = options.timestamp ? formatTimestamp(options.timestamp) : (title.match(/—\s*(.+)$/) || [])[1] || '';
            const modelBadge = options.model ? `<span class="analysis-title-model">${escapeHtml(options.model)}</span>` : '';
            result.push(`
                <div class="analysis-title-card">
                    <div class="analysis-title-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor" opacity="0.2"/>
                            <path d="M2 17l10 5 10-5"/>
                            <path d="M2 12l10 5 10-5"/>
                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                        </svg>
                    </div>
                    <div class="analysis-title-content">
                        <h2 class="analysis-main-title">$${ticker} <span class="title-brief">BRIEF</span></h2>
                        ${displayDate ? `<div class="analysis-title-date">${displayDate}</div>` : ''}
                    </div>
                    ${modelBadge}
                </div>
            `);
            continue;
        }

        // Section headers (e.g., **SENTIMENT**: or **KEY LEVELS**)
        const sectionMatch = line.match(/^\*\*([A-Z][A-Z\s\/]+)\*\*:?\s*(.*)?$/);
        if (sectionMatch) {
            flushList();
            const sectionName = sectionMatch[1].trim();
            const sectionContent = sectionMatch[2] || '';

            // Map section names to icons and colors
            const sectionConfig = getSectionConfig(sectionName);

            // If there's inline content after the header
            if (sectionContent) {
                // For CATALYSTS/NEWS and BOTTOM LINE, we need special bullet point handling
                // even for inline content
                let formattedContent;
                if (sectionName === 'CATALYSTS / NEWS' || sectionName === 'CATALYSTS' || sectionName === 'NEWS') {
                    const segments = splitBySourceLinks(sectionContent);
                    if (segments.length > 1) {
                        formattedContent = `<ul class="analysis-list">${segments.map(s => `<li>${formatInlineMarkdown(s.trim())}</li>`).join('')}</ul>`;
                    } else {
                        formattedContent = formatInlineMarkdown(sectionContent);
                    }
                } else if (sectionName === 'BOTTOM LINE') {
                    const sentences = splitIntoSentences(sectionContent);
                    if (sentences.length > 1) {
                        formattedContent = `<ul class="analysis-list">${sentences.map(s => `<li>${formatInlineMarkdown(s.trim())}</li>`).join('')}</ul>`;
                    } else {
                        formattedContent = formatInlineMarkdown(sectionContent);
                    }
                } else {
                    formattedContent = formatInlineMarkdown(sectionContent);
                }
                result.push(`
                    <div class="analysis-section ${sectionConfig.class}">
                        <div class="analysis-section-header">
                            <span class="analysis-section-icon">${sectionConfig.icon}</span>
                            <span class="analysis-section-title">${sectionName}</span>
                        </div>
                        <div class="analysis-section-content">${formattedContent}</div>
                    </div>
                `);
            } else {
                result.push(`
                    <div class="analysis-section ${sectionConfig.class}">
                        <div class="analysis-section-header">
                            <span class="analysis-section-icon">${sectionConfig.icon}</span>
                            <span class="analysis-section-title">${sectionName}</span>
                        </div>
                        <div class="analysis-section-content">
                `);
                // Content will follow in subsequent lines
                // Look ahead for content
                let contentLines = [];
                let j = i + 1;
                while (j < lines.length) {
                    const nextLine = lines[j];
                    // Stop at next section or empty line followed by section
                    if (nextLine.match(/^\*\*[A-Z][A-Z\s\/]+\*\*:?/)) {
                        break;
                    }
                    if (nextLine.trim() !== '') {
                        contentLines.push(nextLine);
                    } else if (contentLines.length > 0 && lines[j + 1]?.match(/^\*\*[A-Z]/)) {
                        break;
                    }
                    j++;
                }

                // Process content lines, passing section name for special handling
                const contentHtml = processContentLines(contentLines, sectionName);
                result.push(contentHtml);
                result.push(`</div></div>`);
                i = j - 1; // Skip processed lines
            }
            continue;
        }

        // Horizontal rule
        if (line.match(/^---+$/)) {
            flushList();
            continue; // Skip horizontal rules, our sections handle separation
        }

        // List items
        if (line.match(/^[-•]\s+/)) {
            const content = formatInlineMarkdown(line.replace(/^[-•]\s+/, ''));
            listItems.push(`<li>${content}</li>`);
            inList = true;
            continue;
        }

        // Regular paragraph
        flushList();
        result.push(`<p class="analysis-paragraph">${formatInlineMarkdown(line)}</p>`);
    }

    flushList();

    // Apply setup label coloring (Long/Short shades)
    let finalHtml = result.join('');
    finalHtml = colorSetupLabels(finalHtml);

    return finalHtml;
}

/**
 * Custom SVG icons for each section
 */
const SECTION_ICONS = {
    sentiment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 3v18h18"/>
        <path d="M18 9l-5 5-4-4-3 3"/>
        <circle cx="18" cy="9" r="2" fill="currentColor"/>
        <circle cx="13" cy="14" r="2" fill="currentColor"/>
        <circle cx="9" cy="10" r="2" fill="currentColor"/>
    </svg>`,
    levels: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 6h16"/>
        <path d="M4 12h16"/>
        <path d="M4 18h16"/>
        <circle cx="8" cy="6" r="2" fill="currentColor"/>
        <circle cx="16" cy="12" r="2" fill="currentColor"/>
        <circle cx="10" cy="18" r="2" fill="currentColor"/>
    </svg>`,
    setups: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="6"/>
        <circle cx="12" cy="12" r="2" fill="currentColor"/>
        <path d="M12 2v4"/>
        <path d="M12 18v4"/>
        <path d="M2 12h4"/>
        <path d="M18 12h4"/>
    </svg>`,
    catalysts: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" opacity="0.2"/>
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>`,
    redflags: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 21V4"/>
        <path d="M4 4l12 4-12 4"/>
        <path d="M4 4l12 4-12 4" fill="currentColor" opacity="0.3"/>
        <circle cx="19" cy="5" r="3" fill="currentColor" opacity="0.5"/>
    </svg>`,
    bottomline: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 6v6l4 2"/>
        <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.3"/>
    </svg>`,
    default: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M9 9h6"/>
        <path d="M9 13h6"/>
        <path d="M9 17h4"/>
    </svg>`
};

/**
 * Get section configuration (icon, class) based on section name
 */
function getSectionConfig(name) {
    const configs = {
        'SENTIMENT': { icon: SECTION_ICONS.sentiment, class: 'section-sentiment' },
        'KEY LEVELS': { icon: SECTION_ICONS.levels, class: 'section-levels' },
        'SETUPS WORTH WATCHING': { icon: SECTION_ICONS.setups, class: 'section-setups' },
        'CATALYSTS / NEWS': { icon: SECTION_ICONS.catalysts, class: 'section-catalysts' },
        'CATALYSTS': { icon: SECTION_ICONS.catalysts, class: 'section-catalysts' },
        'NEWS': { icon: SECTION_ICONS.catalysts, class: 'section-catalysts' },
        'RED FLAGS': { icon: SECTION_ICONS.redflags, class: 'section-redflags' },
        'BOTTOM LINE': { icon: SECTION_ICONS.bottomline, class: 'section-bottomline' }
    };
    return configs[name] || { icon: SECTION_ICONS.default, class: 'section-default' };
}

/**
 * Process content lines into HTML
 * @param {string[]} lines - Array of content lines
 * @param {string} sectionName - Name of the section (for special handling like BOTTOM LINE)
 */
function processContentLines(lines, sectionName = '') {
    if (lines.length === 0) return '';

    const result = [];
    let listItems = [];

    const flushList = () => {
        if (listItems.length > 0) {
            result.push(`<ul class="analysis-list">${listItems.join('')}</ul>`);
            listItems = [];
        }
    };

    // Join all lines first, then process
    const fullText = lines.join(' ');

    // For BOTTOM LINE, split by sentences
    if (sectionName === 'BOTTOM LINE') {
        const sentences = splitIntoSentences(fullText);
        for (const sentence of sentences) {
            if (sentence.trim()) {
                listItems.push(`<li>${formatInlineMarkdown(sentence.trim())}</li>`);
            }
        }
        flushList();
        return result.join('');
    }

    // For CATALYSTS / NEWS, split by source links or sentences
    if (sectionName === 'CATALYSTS / NEWS' || sectionName === 'CATALYSTS' || sectionName === 'NEWS') {
        const segments = splitBySourceLinks(fullText);
        for (const segment of segments) {
            if (segment.trim()) {
                listItems.push(`<li>${formatInlineMarkdown(segment.trim())}</li>`);
            }
        }
        flushList();
        return result.join('');
    }

    // Default processing for other sections
    for (const line of lines) {
        if (line.match(/^[-•]\s+/)) {
            const content = formatInlineMarkdown(line.replace(/^[-•]\s+/, ''));
            listItems.push(`<li>${content}</li>`);
        } else {
            flushList();
            result.push(`<p>${formatInlineMarkdown(line)}</p>`);
        }
    }

    flushList();
    return result.join('');
}

/**
 * Split text into sentences intelligently
 */
function splitIntoSentences(text) {
    // Split on sentence endings followed by space and capital letter
    const parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
    return parts.filter(p => p.trim()).map(p => p.trim());
}

/**
 * Split text by source links to create bullet points
 * URLs appear in format: ([domain](url)) - note the double )) at end
 */
function splitBySourceLinks(text) {
    // The format from OpenAI is: text ([domain](url?utm_source=openai)) more text
    // We want to split AFTER each )) to create separate bullet points

    // Simple approach: find all occurrences of )) and split there
    const segments = [];
    let currentSegment = '';

    for (let i = 0; i < text.length; i++) {
        currentSegment += text[i];

        // Check if we just added ))
        if (currentSegment.endsWith('))')) {
            // Check if next char is whitespace or end of string
            const nextChar = text[i + 1];
            if (!nextChar || /\s/.test(nextChar)) {
                // This looks like end of a citation, save this segment
                segments.push(currentSegment.trim());
                currentSegment = '';
                // Skip whitespace
                while (i + 1 < text.length && /\s/.test(text[i + 1])) {
                    i++;
                }
            }
        }
    }

    // Don't forget remaining text
    if (currentSegment.trim()) {
        segments.push(currentSegment.trim());
    }

    // If we found multiple segments, return them
    if (segments.length > 1) {
        return segments;
    }

    // Fallback: split by sentences
    return splitIntoSentences(text);
}

/**
 * Format inline markdown (bold, italic, links, etc.)
 * @param {string} text - The text to format
 * @param {string} sectionName - Optional section name for context-specific formatting
 */
function formatInlineMarkdown(text, sectionName = '') {
    let result = text
        // Bold text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Italic text
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Code
        .replace(/`(.*?)`/g, '<code>$1</code>')
        // Markdown links [text](url)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="analysis-link">$1<svg class="link-icon" viewBox="0 0 12 12"><path d="M3.5 3a.5.5 0 0 0 0 1h3.793L2.146 9.146a.5.5 0 1 0 .708.708L8 4.707V8.5a.5.5 0 0 0 1 0v-5a.5.5 0 0 0-.5-.5h-5z" fill="currentColor"/></svg></a>')
        // Plain URLs (https://...)
        .replace(/(?<!\])\((https?:\/\/[^\s)]+)\)/g, '<a href="$1" target="_blank" rel="noopener" class="analysis-link analysis-link-source">source<svg class="link-icon" viewBox="0 0 12 12"><path d="M3.5 3a.5.5 0 0 0 0 1h3.793L2.146 9.146a.5.5 0 1 0 .708.708L8 4.707V8.5a.5.5 0 0 0 1 0v-5a.5.5 0 0 0-.5-.5h-5z" fill="currentColor"/></svg></a>')
        // Highlight key trading terms
        .replace(/\$(\d+(?:,\d{3})*(?:\.\d+)?[KMB]?)\b/g, '<span class="price-highlight">$$$1</span>')
        // Highlight percentage changes
        .replace(/([+-]?\d+(?:\.\d+)?%)/g, '<span class="percent-highlight">$1</span>');

    // Color-coded text for KEY LEVELS section - only at start of line/item
    // Resistance - muted coral
    result = result.replace(/^(<strong>)?Resistance(<\/strong>)?:/gim,
        '<span class="level-text-resistance">Resistance:</span>');

    // Support - muted teal
    result = result.replace(/^(<strong>)?Support(<\/strong>)?:/gim,
        '<span class="level-text-support">Support:</span>');

    // Invalidation - muted amber
    result = result.replace(/^(<strong>)?Invalidation(<\/strong>)?:/gim,
        '<span class="level-text-invalidation">Invalidation:</span>');

    return result;
}

// Shade palettes for setups - distinctly different muted colors
const LONG_SHADES = [
    '#5a9e8f', // teal
    '#7ab86e', // lime green
    '#4a8fa8', // blue-teal
    '#8faa5a', // olive green
    '#5ac9a0', // mint
    '#6b9e5a'  // forest green
];
const SHORT_SHADES = [
    '#c9706e', // coral
    '#b87a9e', // mauve/pink
    '#c9956e', // orange-brown
    '#9e6eb8', // purple
    '#c96e8f', // rose
    '#a87070'  // dusty red
];

/**
 * Color setup labels (Long/Short) with dynamic shades
 */
function colorSetupLabels(html) {
    let longIndex = 0;
    let shortIndex = 0;

    // Match <strong>Label:</strong> patterns where label contains "long" or "short"
    return html.replace(/<strong>([^<]*(?:long|short)[^<]*?):<\/strong>/gi,
        (match, label) => {
            const labelLower = label.toLowerCase();
            let color;

            if (labelLower.includes('short')) {
                color = SHORT_SHADES[shortIndex % SHORT_SHADES.length];
                shortIndex++;
            } else if (labelLower.includes('long')) {
                color = LONG_SHADES[longIndex % LONG_SHADES.length];
                longIndex++;
            } else {
                return match;
            }

            return `<span style="color: ${color}; font-weight: 600;">${label}:</span>`;
        });
}

/**
 * Display analysis results with beautiful formatting
 */
function displayAnalysis(text) {
    const html = parseMarkdownToHtml(text);
    analysisResults.innerHTML = html;
}

/**
 * Convert image URL to base64 data URL
 */
async function imageUrlToBase64(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch image');
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.warn('Failed to convert image:', url, error);
        return null;
    }
}

/**
 * Analyze tweets with OpenAI
 */
async function analyzeTweets() {
    if (!currentResults || currentResults.length === 0) {
        showAnalysisStatus('No tweets to analyze', 'failed');
        return;
    }

    // Disable button and show loading state
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing...';
    analysisSection.style.display = 'block';
    analysisResults.innerHTML = '';
    showAnalysisStatus('Converting images to base64...', 'processing');

    try {
        const packagedTweets = packageTweetsForAnalysis(currentResults);

        // Collect all image URLs
        const allImageUrls = [];
        for (const tweet of packagedTweets) {
            if (tweet.images) {
                allImageUrls.push(...tweet.images);
            }
        }

        // Convert ALL images to base64
        showAnalysisStatus(`Converting ${allImageUrls.length} images...`, 'processing');

        const base64Images = [];
        for (let i = 0; i < allImageUrls.length; i++) {
            const base64 = await imageUrlToBase64(allImageUrls[i]);
            if (base64) {
                base64Images.push(base64);
            }
            // Update progress every 5 images
            if ((i + 1) % 5 === 0) {
                showAnalysisStatus(`Converting images... ${i + 1}/${allImageUrls.length}`, 'processing');
            }
        }

        showAnalysisStatus(`Sending to OpenAI with ${base64Images.length} images...`, 'processing');

        // Get prompt from textarea (allows user customization)
        const userPrompt = promptInput.value.trim() || ANALYSIS_PROMPT;

        // Build content array with text + base64 images
        const content = [
            { type: 'text', text: userPrompt + '\n\nTweet data:\n' + JSON.stringify(packagedTweets, null, 2) }
        ];

        // Add base64 images for vision analysis with HIGH detail for charts
        for (const base64Data of base64Images) {
            content.push({
                type: 'image_url',
                image_url: { url: base64Data, detail: 'high' }
            });
        }

        const selectedModel = modelSelect.value;
        const useWebSearch = selectedModel.includes('search');
        const actualModel = useWebSearch ? 'gpt-5.2' : selectedModel;

        let analysisText;

        if (useWebSearch) {
            // Use Responses API with web_search tool
            const inputText = userPrompt + '\n\nTweet data:\n' + JSON.stringify(packagedTweets, null, 2);

            // Build content array with text + images
            const messageContent = [
                { type: 'input_text', text: inputText }
            ];

            // Add images
            for (const base64Data of base64Images) {
                messageContent.push({
                    type: 'input_image',
                    image_url: base64Data
                });
            }

            const response = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: actualModel,
                    input: [
                        {
                            role: 'user',
                            content: messageContent
                        }
                    ],
                    tools: [{ type: 'web_search' }]
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `API error: ${response.status}`);
            }

            const data = await response.json();

            // Parse Responses API output array
            // The structure is: output[] -> items with type "message" -> content[] -> text
            analysisText = '';
            if (data.output_text) {
                // Some versions include a convenience field
                analysisText = data.output_text;
            } else if (data.output && Array.isArray(data.output)) {
                // Parse the output array manually
                for (const item of data.output) {
                    if (item.type === 'message' && item.content) {
                        for (const contentItem of item.content) {
                            if (contentItem.type === 'output_text' && contentItem.text) {
                                analysisText += contentItem.text;
                            }
                        }
                    }
                }
            }

            if (!analysisText) {
                console.log('Responses API raw response:', JSON.stringify(data, null, 2));
                analysisText = 'No analysis returned. Check console for raw response.';
            }

        } else {
            // Use Chat Completions API (no web search)
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: actualModel,
                    messages: [{ role: 'user', content }],
                    max_completion_tokens: 4000
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `API error: ${response.status}`);
            }

            const data = await response.json();
            analysisText = data.choices[0]?.message?.content || 'No analysis returned';
        }

        // Store for history (both in memory and localStorage)
        currentAnalysis = analysisText;
        currentModel = selectedModel;
        localStorage.setItem('cachedAnalysis', analysisText);
        localStorage.setItem('cachedModel', selectedModel);

        showAnalysisStatus('Analysis complete', 'completed');
        displayAnalysis(analysisText);

    } catch (error) {
        console.error('Analysis error:', error);
        showAnalysisStatus(`Error: ${error.message}`, 'failed');
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'Analyze with AI';
    }
}

/**
 * Restore cached results from localStorage on page load
 */
function restoreCachedResults() {
    try {
        const cachedResults = localStorage.getItem('cachedResults');
        const cachedTicker = localStorage.getItem('cachedTicker');
        const cachedAnalysis = localStorage.getItem('cachedAnalysis');
        const cachedModel = localStorage.getItem('cachedModel');

        if (cachedResults) {
            const tweets = JSON.parse(cachedResults);
            if (tweets && tweets.length > 0) {
                displayResults(tweets);
                if (cachedTicker) {
                    tickerInput.value = cachedTicker;
                    currentTicker = cachedTicker;
                }
                // Restore analysis if it exists
                if (cachedAnalysis) {
                    currentAnalysis = cachedAnalysis;
                    currentModel = cachedModel;
                    analysisSection.style.display = 'block';
                    displayAnalysis(cachedAnalysis);
                    showAnalysisStatus('Restored from cache', 'completed');
                }
                showStatus(`Restored ${tweets.length} tweets from cache`, 'completed');
            }
        }
    } catch (e) {
        console.error('Error restoring cached results:', e);
        localStorage.removeItem('cachedResults');
        localStorage.removeItem('cachedTicker');
        localStorage.removeItem('cachedAnalysis');
        localStorage.removeItem('cachedModel');
    }
}

// Clear history button
clearHistoryBtn.addEventListener('click', clearHistory);

// Clear input button (X inside the field)
clearInputBtn.addEventListener('click', () => {
    tickerInput.value = '';
    tickerInput.focus();
});

// Load history on startup
loadHistory();

/**
 * Save current search to history
 */
function saveToHistory() {
    if (!currentResults || currentResults.length === 0) {
        return; // Nothing to save
    }

    const historyEntry = {
        id: Date.now(),
        ticker: currentTicker || tickerInput.value.trim() || 'Unknown',
        tweets: currentResults,
        analysis: currentAnalysis,
        model: currentModel,
        timestamp: new Date().toISOString()
    };

    // Load existing history
    let history = [];
    try {
        const stored = localStorage.getItem('searchHistory');
        if (stored) {
            history = JSON.parse(stored);
        }
    } catch (e) {
        console.error('Error loading history:', e);
    }

    // Add new entry at the beginning
    history.unshift(historyEntry);

    // Keep only last 20 entries
    if (history.length > 20) {
        history = history.slice(0, 20);
    }

    // Save back
    localStorage.setItem('searchHistory', JSON.stringify(history));

    // Re-render history
    renderHistory(history);
}

/**
 * Load history from localStorage
 */
function loadHistory() {
    try {
        const stored = localStorage.getItem('searchHistory');
        if (stored) {
            const history = JSON.parse(stored);
            renderHistory(history);
        }
    } catch (e) {
        console.error('Error loading history:', e);
    }
}

/**
 * Render history cards
 */
function renderHistory(history) {
    if (!history || history.length === 0) {
        historySection.style.display = 'none';
        return;
    }

    historySection.style.display = 'block';

    historyCards.innerHTML = history.map(entry => {
        const date = new Date(entry.timestamp);
        const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const tweetCount = entry.tweets?.length || 0;
        const hasAnalysis = !!entry.analysis;

        // All tweets with links and images
        const tweetsHtml = (entry.tweets || []).map(tweet => {
            // Build images HTML
            let imagesHtml = '';
            if (tweet.media?.images?.length > 0) {
                const gridClass = tweet.media.images.length === 1 ? 'history-tweet-media history-tweet-media-single' : 'history-tweet-media';
                imagesHtml = `
                    <div class="${gridClass}">
                        ${tweet.media.images.map(img => `<img src="${escapeHtml(img)}" alt="Tweet image" loading="lazy" onclick="window.open('${escapeHtml(img)}', '_blank')" />`).join('')}
                    </div>
                `;
            }

            return `
                <div class="history-tweet-item">
                    <div class="history-tweet-author">${escapeHtml(tweet.author?.displayName || '')} ${escapeHtml(tweet.author?.username || '')}</div>
                    <div class="history-tweet-text">${escapeHtml(tweet.text || '')}</div>
                    ${imagesHtml}
                    ${tweet.url ? `<a href="${escapeHtml(tweet.url)}" target="_blank" class="history-tweet-link">View on Twitter</a>` : ''}
                </div>
            `;
        }).join('');

        // For entries WITH analysis: use the beautiful title card as the header
        // For entries WITHOUT analysis: use the simple collapsible header
        if (hasAnalysis) {
            // Parse analysis but skip the title card (we'll make our own clickable one)
            const analysisContentHtml = parseMarkdownToHtml(entry.analysis, { timestamp: entry.timestamp, model: entry.model, skipTitle: true });

            return `
                <div class="history-card history-card-analyzed" data-id="${entry.id}">
                    <div class="history-card-header-rich">
                        <div class="analysis-title-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor" opacity="0.2"/>
                                <path d="M2 17l10 5 10-5"/>
                                <path d="M2 12l10 5 10-5"/>
                                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                            </svg>
                        </div>
                        <div class="analysis-title-content">
                            <h2 class="analysis-main-title">${escapeHtml(entry.ticker)} <span class="title-brief">BRIEF</span></h2>
                            <div class="analysis-title-date">${formattedDate} • ${tweetCount} tweets</div>
                        </div>
                        <span class="analysis-title-model">${escapeHtml(entry.model || 'AI')}</span>
                        <span class="history-card-arrow">▶</span>
                    </div>
                    <div class="history-card-content">
                        <div class="history-analysis">
                            <div class="history-analysis-content">${analysisContentHtml}</div>
                        </div>
                        <div class="history-tweets-preview">
                            ${tweetsHtml}
                        </div>
                    </div>
                </div>
            `;
        } else {
            // No analysis - use simple header
            return `
                <div class="history-card" data-id="${entry.id}">
                    <div class="history-card-header">
                        <span class="history-card-arrow">▶</span>
                        <span class="history-card-ticker">${escapeHtml(entry.ticker)}</span>
                        <span class="history-card-meta">${formattedDate} • ${tweetCount} tweets</span>
                    </div>
                    <div class="history-card-content">
                        <div class="history-tweets-preview">
                            ${tweetsHtml}
                        </div>
                    </div>
                </div>
            `;
        }
    }).join('');

    // Add click handlers for expand/collapse (both simple and rich headers)
    historyCards.querySelectorAll('.history-card-header, .history-card-header-rich').forEach(header => {
        header.addEventListener('click', () => {
            header.parentElement.classList.toggle('expanded');
        });
    });
}

/**
 * Clear all history
 */
function clearHistory() {
    localStorage.removeItem('searchHistory');
    historySection.style.display = 'none';
    historyCards.innerHTML = '';
}

// Initial focus
tickerInput.focus();
