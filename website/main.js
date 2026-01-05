/**
 * Ticker Scraper - Web Interface
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

let currentJobId = null;
let currentResults = null;

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

    // Disable button while processing
    searchBtn.disabled = true;
    resultsDiv.innerHTML = '';
    jsonSection.style.display = 'none';
    currentResults = null;

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
        displayResults(job.results);
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
function displayResults(tweets) {
    currentResults = tweets;

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

            // Video thumbnails
            if (tweet.media.videoThumbnails && tweet.media.videoThumbnails.length > 0) {
                mediaHtml += `
                    <div class="media-label">Video</div>
                    <div class="tweet-media tweet-media-single">
                        ${tweet.media.videoThumbnails.map(img => `<img src="${escapeHtml(img)}" alt="Video thumbnail" loading="lazy" />`).join('')}
                    </div>
                `;
            }

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

    // Show JSON section
    jsonSection.style.display = 'block';
    jsonOutput.textContent = JSON.stringify(tweets, null, 2);
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
    tickerInput.focus();
}

// Initial focus
tickerInput.focus();
