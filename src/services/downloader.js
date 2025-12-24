const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { URL } = require('url');

// Store active downloads
const downloads = new Map();

// Lazy load renderer (Puppeteer is heavy)
let renderer = null;
async function getRenderer() {
    if (!renderer) {
        renderer = require('./renderer');
    }
    return renderer;
}

/**
 * Start a new download
 */
async function startDownload(downloadId, url, options, io) {
    const downloadDir = path.join(__dirname, '../../downloads', downloadId);

    // Initialize download state
    const state = {
        id: downloadId,
        url,
        options,
        status: 'starting',
        progress: 0,
        filesDownloaded: 0,
        totalFiles: 0,
        currentFile: '',
        error: null,
        zipFile: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
        cancelled: false,
        renderMode: options.renderJavaScript ? 'puppeteer' : 'static'
    };

    downloads.set(downloadId, state);

    // Create download directory
    fs.mkdirSync(downloadDir, { recursive: true });

    try {
        // Emit starting event
        emitProgress(io, downloadId, state);

        // Choose crawl method based on render mode
        state.status = 'downloading';

        if (options.renderJavaScript) {
            state.status = 'rendering';
            emitProgress(io, downloadId, state);
            await crawlWithPuppeteer(url, downloadDir, options, state, io, downloadId);
        } else {
            await crawlWebsite(url, downloadDir, options, state, io, downloadId);
        }

        if (state.cancelled) {
            cleanup(downloadDir);
            return;
        }

        // Archive files
        state.status = 'archiving';
        state.progress = 90;
        emitProgress(io, downloadId, state);

        await createArchive(downloadDir, downloadId);

        // Complete
        state.status = 'completed';
        state.progress = 100;
        state.zipFile = `/downloads/${downloadId}.zip`;
        state.completedAt = new Date().toISOString();

        emitProgress(io, downloadId, state);

        // Cleanup source files (keep only ZIP)
        fs.rmSync(downloadDir, { recursive: true, force: true });

    } catch (error) {
        console.error('Download error:', error);
        state.status = 'error';
        state.error = error.message;
        emitProgress(io, downloadId, state);
        cleanup(downloadDir);
    }
}

/**
 * Crawl website using Puppeteer (for JavaScript-heavy sites)
 */
async function crawlWithPuppeteer(startUrl, downloadDir, options, state, io, downloadId) {
    const rendererService = await getRenderer();
    const visited = new Set();
    const baseUrl = new URL(startUrl);

    // Track pages at each depth level
    const depthQueue = [[startUrl]];
    let depth = 0;

    while (depth < options.depth && depthQueue[depth] && depthQueue[depth].length > 0) {
        if (state.cancelled) break;

        const currentLevel = depthQueue[depth];
        const nextLevel = [];

        for (const url of currentLevel) {
            if (state.cancelled) break;
            if (visited.has(url)) continue;

            visited.add(url);
            state.currentFile = `Rendering: ${new URL(url).pathname}`;
            emitProgress(io, downloadId, state);

            try {
                // Render the page with Puppeteer
                const result = await rendererService.renderPage(url, {
                    waitUntil: 'networkidle2',
                    timeout: 60000
                });

                // Save the rendered HTML
                const urlObj = new URL(url);
                let filePath = urlObj.pathname || '/index.html';
                if (filePath === '/' || filePath === '') {
                    filePath = '/index.html';
                }
                if (!filePath.endsWith('.html')) {
                    filePath = filePath + '.html';
                }

                const safePath = path.join(downloadDir, filePath.replace(/[<>:"|?*]/g, '_'));
                const dirPath = path.dirname(safePath);
                fs.mkdirSync(dirPath, { recursive: true });
                fs.writeFileSync(safePath, result.html);

                state.filesDownloaded++;
                state.progress = Math.min(85, (state.filesDownloaded / Math.max(state.totalFiles, state.filesDownloaded + 10)) * 85);
                emitProgress(io, downloadId, state);

                // Download assets
                if (result.resources && result.resources.items) {
                    for (const resource of result.resources.items) {
                        if (state.cancelled) break;

                        // Filter by options
                        if (resource.type === 'image' && !options.includeImages) continue;
                        if (resource.type === 'css' && !options.includeStyles) continue;
                        if (resource.type === 'js' && !options.includeScripts) continue;

                        await downloadAsset(resource.url, downloadDir, baseUrl, state);
                    }
                }

                // Add links to next level
                if (result.resources && result.resources.links) {
                    for (const link of result.resources.links) {
                        if (!visited.has(link) && isSameDomain(link, baseUrl)) {
                            nextLevel.push(link);
                            state.totalFiles++;
                        }
                    }
                }

            } catch (err) {
                console.warn(`Failed to render: ${url}`, err.message);
            }
        }

        if (nextLevel.length > 0) {
            depthQueue.push(nextLevel);
        }
        depth++;
    }
}

/**
 * Crawl website and download files (static mode)
 */
async function crawlWebsite(startUrl, downloadDir, options, state, io, downloadId) {
    const visited = new Set();
    const baseUrl = new URL(startUrl);
    const files = [];
    let depth = 0;

    // Track files at each depth level
    const depthQueue = [[startUrl]];

    while (depth < options.depth && depthQueue[depth] && depthQueue[depth].length > 0) {
        if (state.cancelled) break;

        const currentLevel = depthQueue[depth];
        const nextLevel = [];

        for (const url of currentLevel) {
            if (state.cancelled) break;
            if (visited.has(url)) continue;

            visited.add(url);

            try {
                const result = await downloadPage(url, downloadDir, baseUrl, options, state);

                if (result) {
                    files.push(result.file);
                    state.filesDownloaded++;
                    state.currentFile = result.file;
                    state.progress = Math.min(85, (state.filesDownloaded / Math.max(state.totalFiles, state.filesDownloaded + 10)) * 85);

                    // Add new links to next level
                    for (const link of result.links) {
                        if (!visited.has(link) && isSameDomain(link, baseUrl)) {
                            nextLevel.push(link);
                            state.totalFiles++;
                        }
                    }

                    emitProgress(io, downloadId, state);
                }
            } catch (err) {
                console.warn(`Failed to download: ${url}`, err.message);
            }
        }

        if (nextLevel.length > 0) {
            depthQueue.push(nextLevel);
        }
        depth++;
    }

    return files;
}

/**
 * Download a single page and extract links (static mode)
 */
async function downloadPage(url, downloadDir, baseUrl, options, state) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const urlObj = new URL(url);
        let filePath = urlObj.pathname || '/index.html';

        // Handle root path
        if (filePath === '/' || filePath === '') {
            filePath = '/index.html';
        }

        // Add .html extension if needed
        if (contentType.includes('text/html') && !filePath.endsWith('.html')) {
            filePath = filePath + '.html';
        }

        // Create safe file path
        const safePath = path.join(downloadDir, filePath.replace(/[<>:"|?*]/g, '_'));
        const dirPath = path.dirname(safePath);

        fs.mkdirSync(dirPath, { recursive: true });

        // Download content
        const buffer = await response.buffer();

        // Check file size limit (in MB)
        const sizeMB = buffer.length / (1024 * 1024);
        if (sizeMB > options.maxSize / 10) {
            throw new Error('File too large');
        }

        fs.writeFileSync(safePath, buffer);

        // Parse HTML for links
        const links = [];
        if (contentType.includes('text/html')) {
            const $ = cheerio.load(buffer.toString());

            // Extract links
            $('a[href]').each((_, el) => {
                const href = $(el).attr('href');
                const absoluteUrl = resolveUrl(href, url);
                if (absoluteUrl) links.push(absoluteUrl);
            });

            // Download CSS if enabled
            if (options.includeStyles) {
                $('link[rel="stylesheet"]').each((_, el) => {
                    const href = $(el).attr('href');
                    const absoluteUrl = resolveUrl(href, url);
                    if (absoluteUrl) downloadAsset(absoluteUrl, downloadDir, baseUrl, state);
                });
            }

            // Download images if enabled
            if (options.includeImages) {
                $('img[src]').each((_, el) => {
                    const src = $(el).attr('src');
                    const absoluteUrl = resolveUrl(src, url);
                    if (absoluteUrl) downloadAsset(absoluteUrl, downloadDir, baseUrl, state);
                });
            }
        }

        return { file: safePath, links };

    } catch (error) {
        clearTimeout(timeout);
        throw error;
    }
}

/**
 * Download an asset file (CSS, image, etc.)
 */
async function downloadAsset(url, downloadDir, baseUrl, state) {
    if (state.cancelled) return;

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) return;

        const urlObj = new URL(url);
        let filePath = urlObj.pathname;

        if (!filePath || filePath === '/') return;

        const safePath = path.join(downloadDir, filePath.replace(/[<>:"|?*]/g, '_'));
        const dirPath = path.dirname(safePath);

        // Skip if already exists
        if (fs.existsSync(safePath)) return;

        fs.mkdirSync(dirPath, { recursive: true });

        const buffer = await response.buffer();
        fs.writeFileSync(safePath, buffer);

        state.filesDownloaded++;

    } catch (err) {
        // Silently fail for assets
    }
}

/**
 * Create ZIP archive
 */
function createArchive(sourceDir, downloadId) {
    return new Promise((resolve, reject) => {
        const zipPath = path.join(__dirname, '../../downloads', `${downloadId}.zip`);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => resolve(zipPath));
        archive.on('error', reject);

        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

/**
 * Resolve relative URL to absolute
 */
function resolveUrl(href, base) {
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
        return null;
    }

    try {
        const url = new URL(href, base);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
            return url.href;
        }
    } catch {
        return null;
    }

    return null;
}

/**
 * Check if URL is same domain
 */
function isSameDomain(url, baseUrl) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname === baseUrl.hostname;
    } catch {
        return false;
    }
}

/**
 * Emit progress to socket
 */
function emitProgress(io, downloadId, state) {
    io.emit(`download:${downloadId}`, {
        id: state.id,
        status: state.status,
        progress: Math.round(state.progress),
        filesDownloaded: state.filesDownloaded,
        currentFile: state.currentFile,
        error: state.error,
        zipFile: state.zipFile,
        renderMode: state.renderMode
    });
}

/**
 * Cleanup download directory
 */
function cleanup(dir) {
    try {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    } catch (err) {
        console.error('Cleanup error:', err);
    }
}

/**
 * Cancel a download
 */
function cancelDownload(downloadId) {
    const state = downloads.get(downloadId);
    if (!state || state.status === 'completed' || state.status === 'error') {
        return false;
    }

    state.cancelled = true;
    state.status = 'cancelled';
    downloads.set(downloadId, state);
    return true;
}

/**
 * Get download status
 */
function getDownloadStatus(downloadId) {
    return downloads.get(downloadId) || null;
}

/**
 * Get all downloads
 */
function getAllDownloads() {
    return Array.from(downloads.values());
}

module.exports = {
    startDownload,
    cancelDownload,
    getDownloadStatus,
    getAllDownloads,
    downloads
};
