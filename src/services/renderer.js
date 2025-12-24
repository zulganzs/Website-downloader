const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Browser instance (reused for performance)
let browserInstance = null;

/**
 * Get or create browser instance
 */
async function getBrowser() {
    if (!browserInstance) {
        browserInstance = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920x1080'
            ]
        });

        // Handle browser close
        browserInstance.on('disconnected', () => {
            browserInstance = null;
        });
    }

    return browserInstance;
}

/**
 * Render a page with JavaScript and return the fully rendered HTML
 */
async function renderPage(url, options = {}) {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        // Set viewport
        await page.setViewport({
            width: options.width || 1920,
            height: options.height || 1080
        });

        // Set user agent
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        // Navigate to the page
        await page.goto(url, {
            waitUntil: options.waitUntil || 'networkidle2',
            timeout: options.timeout || 60000
        });

        // Wait for any additional content to load
        if (options.waitForSelector) {
            await page.waitForSelector(options.waitForSelector, { timeout: 10000 }).catch(() => { });
        }

        // Additional wait for dynamic content
        await page.evaluate(() => {
            return new Promise((resolve) => {
                setTimeout(resolve, 2000);
            });
        });

        // Get the fully rendered HTML
        const html = await page.content();

        // Get all resources
        const resources = await extractResources(page, url);

        return {
            html,
            resources,
            title: await page.title(),
            url: page.url()
        };

    } finally {
        await page.close();
    }
}

/**
 * Extract all resources from the page (images, styles, scripts, etc.)
 */
async function extractResources(page, baseUrl) {
    const resources = await page.evaluate(() => {
        const items = [];

        // Get stylesheets
        document.querySelectorAll('link[rel="stylesheet"]').forEach(el => {
            if (el.href) items.push({ type: 'css', url: el.href });
        });

        // Get inline styles with @import
        document.querySelectorAll('style').forEach(el => {
            const imports = el.textContent.match(/@import\s+url\(['"]?([^'")\s]+)['"]?\)/g);
            if (imports) {
                imports.forEach(imp => {
                    const match = imp.match(/url\(['"]?([^'")\s]+)['"]?\)/);
                    if (match) items.push({ type: 'css', url: match[1] });
                });
            }
        });

        // Get scripts
        document.querySelectorAll('script[src]').forEach(el => {
            if (el.src) items.push({ type: 'js', url: el.src });
        });

        // Get images
        document.querySelectorAll('img[src]').forEach(el => {
            if (el.src) items.push({ type: 'image', url: el.src });
        });

        // Get background images from inline styles
        document.querySelectorAll('[style*="background"]').forEach(el => {
            const match = el.style.cssText.match(/url\(['"]?([^'")\s]+)['"]?\)/);
            if (match) items.push({ type: 'image', url: match[1] });
        });

        // Get videos
        document.querySelectorAll('video source, video[src]').forEach(el => {
            const src = el.src || el.getAttribute('src');
            if (src) items.push({ type: 'video', url: src });
        });

        // Get fonts
        document.querySelectorAll('link[rel="preload"][as="font"], link[rel="stylesheet"]').forEach(el => {
            if (el.href && el.href.match(/\.(woff2?|ttf|otf|eot)(\?|$)/i)) {
                items.push({ type: 'font', url: el.href });
            }
        });

        // Get all links for further crawling
        const links = [];
        document.querySelectorAll('a[href]').forEach(el => {
            if (el.href && !el.href.startsWith('javascript:') && !el.href.startsWith('#')) {
                links.push(el.href);
            }
        });

        return { items, links };
    });

    return resources;
}

/**
 * Take a screenshot of a page
 */
async function takeScreenshot(url, options = {}) {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.setViewport({
            width: options.width || 1280,
            height: options.height || 720
        });

        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Wait for content
        await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));

        const screenshot = await page.screenshot({
            type: 'png',
            fullPage: options.fullPage || false,
            encoding: options.encoding || 'binary'
        });

        return screenshot;

    } finally {
        await page.close();
    }
}

/**
 * Download a resource using Puppeteer (for resources that need cookies/session)
 */
async function downloadResource(url, page) {
    try {
        const response = await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 15000
        });

        if (response && response.ok()) {
            return await response.buffer();
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Cleanup browser on process exit
 */
async function closeBrowser() {
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
    }
}

// Cleanup on exit
process.on('SIGINT', closeBrowser);
process.on('SIGTERM', closeBrowser);
process.on('exit', closeBrowser);

module.exports = {
    renderPage,
    takeScreenshot,
    extractResources,
    closeBrowser,
    getBrowser
};
