/**
 * Ticker Scraper - Web Interface
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { OPENAI_API_KEY } from './config.js';

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
const promptInput = document.getElementById('prompt-input');
const analysisSection = document.getElementById('analysis-section');
const analysisStatus = document.getElementById('analysis-status');
const analysisResults = document.getElementById('analysis-results');
const packageBtn = document.getElementById('package-btn');
const packageSection = document.getElementById('package-section');
const packageOutput = document.getElementById('package-output');
const packageStats = document.getElementById('package-stats');
const packageImages = document.getElementById('package-images');

let currentJobId = null;
let currentResults = null;

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

// Package button click
packageBtn.addEventListener('click', packagePrompt);

// Analyze button click
analyzeBtn.addEventListener('click', analyzeTweets);

// Save prompt to localStorage as user types
promptInput.addEventListener('input', () => {
    localStorage.setItem('cachedPrompt', promptInput.value);
});

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

    // Disable button and clear previous results completely
    searchBtn.disabled = true;
    resultsDiv.innerHTML = '';
    jsonSection.style.display = 'none';
    jsonOutput.textContent = '';
    jsonOutput.classList.add('hidden');
    jsonToggleBtn.textContent = 'Show Raw JSON';
    currentResults = null;
    currentJobId = null;
    analyzeBtn.disabled = true;
    packageBtn.disabled = true;
    analysisSection.style.display = 'none';
    analysisResults.innerHTML = '';
    analysisStatus.className = 'status hidden';
    packageSection.style.display = 'none';
    packageOutput.textContent = '';
    packageImages.innerHTML = '';

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

    // Show JSON section and enable buttons
    jsonSection.style.display = 'block';
    jsonOutput.textContent = JSON.stringify(tweets, null, 2);
    packageBtn.disabled = false;
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
    tickerInput.value = '';
    statusDiv.className = 'status hidden';
    resultsDiv.innerHTML = '';
    jsonSection.style.display = 'none';
    jsonOutput.textContent = '';
    jsonOutput.classList.add('hidden');
    jsonToggleBtn.textContent = 'Show Raw JSON';
    currentResults = null;
    currentJobId = null;
    searchBtn.disabled = false;
    analyzeBtn.disabled = true;
    packageBtn.disabled = true;
    analysisSection.style.display = 'none';
    analysisResults.innerHTML = '';
    analysisStatus.className = 'status hidden';
    packageSection.style.display = 'none';
    packageOutput.textContent = '';
    packageImages.innerHTML = '';
    // Clear localStorage cache
    localStorage.removeItem('cachedResults');
    localStorage.removeItem('cachedTicker');
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
 * Package and preview the prompt before sending to OpenAI
 */
function packagePrompt() {
    if (!currentResults || currentResults.length === 0) {
        return;
    }

    const userPrompt = promptInput.value.trim();
    if (!userPrompt) {
        packageSection.style.display = 'block';
        packageOutput.textContent = '⚠️ Please enter an analysis prompt first';
        packageStats.textContent = '';
        packageImages.innerHTML = '';
        analyzeBtn.disabled = true;
        return;
    }

    const packagedTweets = packageTweetsForAnalysis(currentResults);

    // Build the text portion of the prompt
    const textContent = userPrompt + '\n\nTweet data:\n' + JSON.stringify(packagedTweets, null, 2);

    // Collect all images
    const allImages = [];
    for (const tweet of packagedTweets) {
        if (tweet.images) {
            allImages.push(...tweet.images);
        }
    }

    // Calculate approximate token count (rough estimate: 4 chars per token)
    const estimatedTokens = Math.ceil(textContent.length / 4);

    // Display the packaged prompt
    packageSection.style.display = 'block';
    packageOutput.textContent = textContent;
    packageStats.textContent = `~${estimatedTokens.toLocaleString()} text tokens | ${allImages.length} images`;

    // Display image thumbnails
    if (allImages.length > 0) {
        packageImages.innerHTML = `
            <div class="package-images-label">Images to be analyzed (${allImages.length}):</div>
            <div class="package-images-grid">
                ${allImages.map(url => `<img src="${escapeHtml(url)}" alt="Tweet image" loading="lazy" />`).join('')}
            </div>
        `;
    } else {
        packageImages.innerHTML = '<div class="package-images-label">No images in this batch</div>';
    }

    // Enable analyze button
    analyzeBtn.disabled = false;
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

    const userPrompt = promptInput.value.trim();
    if (!userPrompt) {
        showAnalysisStatus('Please enter an analysis prompt', 'failed');
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

        if (cachedResults) {
            const tweets = JSON.parse(cachedResults);
            if (tweets && tweets.length > 0) {
                displayResults(tweets);
                if (cachedTicker) {
                    tickerInput.value = cachedTicker;
                }
                showStatus(`Restored ${tweets.length} tweets from cache`, 'completed');
            }
        }

        // Restore cached prompt
        const cachedPrompt = localStorage.getItem('cachedPrompt');
        if (cachedPrompt) {
            promptInput.value = cachedPrompt;
        }

        // Enable analyze button if we have both results and prompt
        if (currentResults && currentResults.length > 0 && cachedPrompt && cachedPrompt.trim()) {
            analyzeBtn.disabled = false;
        }
    } catch (e) {
        console.error('Error restoring cached results:', e);
        localStorage.removeItem('cachedResults');
        localStorage.removeItem('cachedTicker');
        localStorage.removeItem('cachedPrompt');
    }
}

// Initial focus
tickerInput.focus();
