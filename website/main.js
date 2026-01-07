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
 * Display analysis results
 */
function displayAnalysis(text) {
    // Convert markdown-style formatting to HTML (basic)
    const formatted = escapeHtml(text)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

    analysisResults.innerHTML = formatted;
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

        // Analysis section if available
        const analysisHtml = hasAnalysis ? `
            <div class="history-analysis">
                <div class="history-analysis-title">AI Analysis (${escapeHtml(entry.model || 'Unknown model')})</div>
                <div class="history-analysis-text">${escapeHtml(entry.analysis)}</div>
            </div>
        ` : '';

        return `
            <div class="history-card" data-id="${entry.id}">
                <div class="history-card-header">
                    <span class="history-card-arrow">▶</span>
                    <span class="history-card-ticker">${escapeHtml(entry.ticker)}</span>
                    <span class="history-card-meta">${formattedDate} • ${tweetCount} tweets</span>
                    ${hasAnalysis ? '<span class="history-card-badge">Analyzed</span>' : ''}
                </div>
                <div class="history-card-content">
                    <div class="history-tweets-preview">
                        ${tweetsHtml}
                    </div>
                    ${analysisHtml}
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers for expand/collapse
    historyCards.querySelectorAll('.history-card-header').forEach(header => {
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
