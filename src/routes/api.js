const express = require('express');
const router = express.Router();
const validator = require('validator');
const { v4: uuidv4 } = require('uuid');
const { startDownload, cancelDownload, getDownloadStatus, getAllDownloads } = require('../services/downloader');

/**
 * POST /api/download
 * Start a new website download
 */
router.post('/download', async (req, res) => {
    try {
        const { url, options = {} } = req.body;

        // Validate URL
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Sanitize and validate URL
        const sanitizedUrl = url.trim();

        if (!validator.isURL(sanitizedUrl, {
            protocols: ['http', 'https'],
            require_protocol: true,
            require_valid_protocol: true
        })) {
            return res.status(400).json({ error: 'Invalid URL. Must be a valid http or https URL.' });
        }

        // Block localhost and private IPs
        const urlObj = new URL(sanitizedUrl);
        const hostname = urlObj.hostname.toLowerCase();

        const blockedPatterns = [
            /^localhost$/i,
            /^127\./,
            /^10\./,
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
            /^192\.168\./,
            /^0\./,
            /^::1$/,
            /^fc00:/i,
            /^fe80:/i
        ];

        if (blockedPatterns.some(pattern => pattern.test(hostname))) {
            return res.status(400).json({ error: 'Cannot download from localhost or private networks' });
        }

        // Parse options
        const downloadOptions = {
            depth: Math.min(Math.max(parseInt(options.depth) || 2, 1), 5),
            maxSize: Math.min(parseInt(options.maxSize) || 100, 500), // Max 500MB
            includeImages: options.includeImages !== false,
            includeStyles: options.includeStyles !== false,
            includeScripts: options.includeScripts !== false,
            renderJavaScript: options.renderJavaScript === true // Enable Puppeteer rendering
        };

        // Generate unique download ID
        const downloadId = uuidv4();

        // Get socket.io instance
        const io = req.app.get('io');

        // Start download in background
        startDownload(downloadId, sanitizedUrl, downloadOptions, io);

        res.status(202).json({
            success: true,
            downloadId,
            message: 'Download started',
            url: sanitizedUrl,
            options: downloadOptions
        });

    } catch (error) {
        console.error('Download API error:', error);
        res.status(500).json({ error: 'Failed to start download' });
    }
});

/**
 * GET /api/download/:id
 * Get status of a download
 */
router.get('/download/:id', (req, res) => {
    const { id } = req.params;

    if (!validator.isUUID(id)) {
        return res.status(400).json({ error: 'Invalid download ID' });
    }

    const status = getDownloadStatus(id);

    if (!status) {
        return res.status(404).json({ error: 'Download not found' });
    }

    res.json(status);
});

/**
 * DELETE /api/download/:id
 * Cancel a download
 */
router.delete('/download/:id', (req, res) => {
    const { id } = req.params;

    if (!validator.isUUID(id)) {
        return res.status(400).json({ error: 'Invalid download ID' });
    }

    const cancelled = cancelDownload(id);

    if (!cancelled) {
        return res.status(404).json({ error: 'Download not found or already completed' });
    }

    res.json({ success: true, message: 'Download cancelled' });
});

/**
 * GET /api/downloads
 * Get all active downloads
 */
router.get('/downloads', (req, res) => {
    const downloads = getAllDownloads();
    res.json(downloads);
});

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
