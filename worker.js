/**
 * Twitter Scraper Worker
 *
 * This script:
 * 1. Connects to Supabase and listens for new jobs
 * 2. When a job arrives, connects to your running Chrome
 * 3. Scrapes Twitter for the requested ticker
 * 4. Writes results back to Supabase
 */

require('dotenv').config();
const puppeteer = require('puppeteer-core');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CHROME_DEBUG_URL = 'http://localhost:9222';

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Global browser and page references - reuse single tab
let browser = null;
let page = null;

console.log('[Worker] Starting Twitter Scraper Worker...');
console.log('[Worker] Supabase URL:', SUPABASE_URL);

/**
 * Get or create the browser connection and dedicated scraper page
 */
async function getPage() {
    if (!browser || !browser.isConnected()) {
        browser = await puppeteer.connect({
            browserURL: CHROME_DEBUG_URL,
            defaultViewport: null
        });
        console.log('[Worker] Connected to Chrome');
    }

    // If we already have a dedicated page, reuse it
    if (page) {
        try {
            // Check if page is still valid
            await page.evaluate(() => true);
            return page;
        } catch (e) {
            // Page was closed, need to find or create one
            page = null;
        }
    }

    // Look for an existing tab we can reuse (x.com tab or about:blank)
    const pages = await browser.pages();

    // First, try to find an existing x.com/twitter tab
    let existingTab = pages.find(p => {
        const url = p.url();
        return url.includes('x.com') || url.includes('twitter.com');
    });

    // If no twitter tab, look for about:blank
    if (!existingTab) {
        existingTab = pages.find(p => p.url() === 'about:blank');
    }

    if (existingTab) {
        page = existingTab;
        console.log('[Worker] Reusing existing tab for scraping');
    } else {
        // Only create a new tab if we really need one
        page = await browser.newPage();
        console.log('[Worker] Created dedicated scraper tab');
    }

    return page;
}

/**
 * Scrape Twitter for a given ticker
 */
async function scrapeTweets(ticker) {
    console.log(`[Worker] Scraping tweets for: ${ticker}`);

    const page = await getPage();

    // Build search URL - search for the ticker
    const searchQuery = encodeURIComponent(ticker);
    const searchUrl = `https://x.com/search?q=${searchQuery}&src=typed_query`;

    console.log(`[Worker] Navigating to: ${searchUrl}`);

    // Bring the scraper tab to the foreground - required for images to load properly
    await page.bringToFront();

    await page.goto(searchUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
    });

    // Wait for tweets to load
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });

    // Collect tweets while scrolling (Twitter virtualizes the list)
    const allTweets = new Map(); // Use Map to dedupe by URL
    const targetCount = 20;
    const maxScrolls = 15;

    for (let scroll = 0; scroll < maxScrolls && allTweets.size < targetCount; scroll++) {
        // Extract currently visible tweets
        const currentTweets = await page.evaluate(() => {
            const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');
            const results = [];

            tweetElements.forEach((tweet) => {
                try {
                    // Get tweet text
                    const textElement = tweet.querySelector('[data-testid="tweetText"]');
                    const text = textElement ? textElement.innerText : '';

                    // Get author info
                    const authorElement = tweet.querySelector('[data-testid="User-Name"]');
                    const authorText = authorElement ? authorElement.innerText : '';
                    const authorParts = authorText.split('\n');
                    const displayName = authorParts[0] || '';
                    const username = authorParts[1] || '';

                    // Get timestamp
                    const timeElement = tweet.querySelector('time');
                    const timestamp = timeElement ? timeElement.getAttribute('datetime') : '';
                    const relativeTime = timeElement ? timeElement.innerText : '';

                    // Get engagement metrics
                    const replyButton = tweet.querySelector('[data-testid="reply"]');
                    const retweetButton = tweet.querySelector('[data-testid="retweet"]');
                    const likeButton = tweet.querySelector('[data-testid="like"]');

                    const replies = replyButton ? replyButton.innerText || '0' : '0';
                    const retweets = retweetButton ? retweetButton.innerText || '0' : '0';
                    const likes = likeButton ? likeButton.innerText || '0' : '0';

                    // Get tweet link
                    const linkElement = tweet.querySelector('a[href*="/status/"]');
                    const tweetUrl = linkElement ? linkElement.href : '';

                    // Get images
                    const images = [];
                    const imageElements = tweet.querySelectorAll('[data-testid="tweetPhoto"] img');
                    imageElements.forEach(img => {
                        let src = img.src;
                        if (src && src.includes('pbs.twimg.com/media')) {
                            src = src.replace(/&name=\w+/, '&name=large');
                            if (!src.includes('&name=')) {
                                src = src + '&name=large';
                            }
                            images.push(src);
                        }
                    });

                    // Get video thumbnails
                    const videoThumbnails = [];
                    const videoElements = tweet.querySelectorAll('[data-testid="videoPlayer"] video');
                    videoElements.forEach(video => {
                        const poster = video.poster;
                        if (poster) {
                            videoThumbnails.push(poster);
                        }
                    });

                    // Get GIFs
                    const gifs = [];
                    const gifElements = tweet.querySelectorAll('[data-testid="tweetGif"] video');
                    gifElements.forEach(gif => {
                        const src = gif.src;
                        if (src) {
                            gifs.push(src);
                        }
                    });

                    // Get card/preview images
                    const cardImages = [];
                    const cardElements = tweet.querySelectorAll('[data-testid="card.wrapper"] img');
                    cardElements.forEach(img => {
                        if (img.src && img.src.includes('pbs.twimg.com')) {
                            cardImages.push(img.src);
                        }
                    });

                    if ((text || images.length > 0) && tweetUrl) {
                        results.push({
                            text,
                            author: { displayName, username },
                            timestamp,
                            relativeTime,
                            engagement: { replies, retweets, likes },
                            media: { images, videoThumbnails, gifs, cardImages },
                            url: tweetUrl
                        });
                    }
                } catch (e) {
                    // Skip problematic tweets
                }
            });

            return results;
        });

        // Add new tweets to our collection (dedupe by URL)
        for (const tweet of currentTweets) {
            if (tweet.url && !allTweets.has(tweet.url)) {
                allTweets.set(tweet.url, tweet);
            }
        }

        console.log(`[Worker] Scroll ${scroll + 1}: collected ${allTweets.size} tweets (${currentTweets.length} visible)`);

        // Scroll down to load more
        await page.evaluate(() => window.scrollBy(0, 800));
        await new Promise(r => setTimeout(r, 1000));
    }

    const tweets = Array.from(allTweets.values()).slice(0, targetCount);
    console.log(`[Worker] Scraped ${tweets.length} tweets`);

    // Switch back to the localhost tab (search panel)
    try {
        const pages = await browser.pages();
        const localhostPage = pages.find(p => p.url().includes('localhost'));
        if (localhostPage) {
            await localhostPage.bringToFront();
            console.log('[Worker] Switched back to search panel');
        }
    } catch (e) {
        // Ignore errors switching back
    }

    return tweets;
}

/**
 * Process a job from the queue
 */
async function processJob(job) {
    console.log(`[Worker] Processing job ${job.id} for ticker: ${job.ticker}`);

    try {
        // Update status to processing
        await supabase
            .from('jobs')
            .update({ status: 'processing' })
            .eq('id', job.id);

        // Scrape tweets
        const tweets = await scrapeTweets(job.ticker);

        // Update job with results
        await supabase
            .from('jobs')
            .update({
                status: 'completed',
                results: tweets,
                completed_at: new Date().toISOString()
            })
            .eq('id', job.id);

        console.log(`[Worker] Job ${job.id} completed successfully`);

    } catch (error) {
        console.error(`[Worker] Job ${job.id} failed:`, error.message);

        // Update job with error
        await supabase
            .from('jobs')
            .update({
                status: 'failed',
                results: { error: error.message },
                completed_at: new Date().toISOString()
            })
            .eq('id', job.id);
    }
}

/**
 * Check for any pending jobs on startup
 */
async function checkPendingJobs() {
    const { data: pendingJobs, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('[Worker] Error checking pending jobs:', error);
        return;
    }

    if (pendingJobs && pendingJobs.length > 0) {
        console.log(`[Worker] Found ${pendingJobs.length} pending jobs`);
        for (const job of pendingJobs) {
            await processJob(job);
        }
    }
}

/**
 * Main function - start listening for jobs
 */
async function main() {
    // Verify Chrome is accessible
    try {
        await getPage();
        console.log('[Worker] Chrome connection verified');
    } catch (error) {
        console.error('[Worker] Cannot connect to Chrome. Please start Chrome with:');
        console.error('  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222');
        process.exit(1);
    }

    console.log('[Worker] Connected to Supabase');

    // Process any pending jobs
    await checkPendingJobs();

    // Subscribe to new jobs
    console.log('[Worker] Listening for new jobs...');

    const subscription = supabase
        .channel('jobs-channel')
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'jobs'
            },
            async (payload) => {
                console.log('[Worker] New job received:', payload.new.ticker);
                await processJob(payload.new);
            }
        )
        .subscribe((status) => {
            console.log('[Worker] Subscription status:', status);
        });

    // Keep process running
    console.log('[Worker] Worker is running. Press Ctrl+C to stop.');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[Worker] Shutting down...');
    process.exit(0);
});

// Start the worker
main().catch(console.error);
