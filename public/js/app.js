/**
 * Website Downloader - Frontend Application
 */

// DOM Elements
const elements = {
    form: document.getElementById('download-form'),
    urlInput: document.getElementById('url-input'),
    downloadBtn: document.getElementById('download-btn'),
    pasteBtn: document.getElementById('paste-btn'),
    depthSelect: document.getElementById('depth'),
    includeImages: document.getElementById('include-images'),
    includeStyles: document.getElementById('include-styles'),
    includeScripts: document.getElementById('include-scripts'),
    renderJavaScript: document.getElementById('render-javascript'),
    progressSection: document.getElementById('progress-section'),
    progressStatus: document.getElementById('progress-status'),
    progressFiles: document.getElementById('progress-files'),
    progressBar: document.getElementById('progress-bar'),
    progressCurrent: document.getElementById('progress-current'),
    cancelBtn: document.getElementById('cancel-btn'),
    resultSection: document.getElementById('result-section'),
    resultInfo: document.getElementById('result-info'),
    downloadLink: document.getElementById('download-link'),
    errorSection: document.getElementById('error-section'),
    errorMessage: document.getElementById('error-message'),
    retryBtn: document.getElementById('retry-btn'),
    historySection: document.getElementById('history-section'),
    historyList: document.getElementById('history-list')
};

// State
let socket = null;
let currentDownloadId = null;
let downloadHistory = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    loadHistory();
    setupEventListeners();
});

/**
 * Initialize Socket.io connection
 */
function initSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connected to server');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Form submission
    elements.form.addEventListener('submit', handleSubmit);

    // Paste button
    elements.pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            elements.urlInput.value = text;
            elements.urlInput.focus();
        } catch (err) {
            console.error('Failed to paste:', err);
        }
    });

    // Cancel button
    elements.cancelBtn.addEventListener('click', handleCancel);

    // Retry button
    elements.retryBtn.addEventListener('click', () => {
        resetUI();
        elements.urlInput.focus();
    });

    // Enter key on input
    elements.urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            elements.form.dispatchEvent(new Event('submit'));
        }
    });
}

/**
 * Handle form submission
 */
async function handleSubmit(e) {
    e.preventDefault();

    const url = elements.urlInput.value.trim();

    if (!url) {
        showError('Please enter a URL');
        return;
    }

    // Basic URL validation
    if (!isValidUrl(url)) {
        showError('Please enter a valid URL starting with http:// or https://');
        return;
    }

    // Get options
    const options = {
        depth: parseInt(elements.depthSelect.value),
        includeImages: elements.includeImages.checked,
        includeStyles: elements.includeStyles.checked,
        includeScripts: elements.includeScripts.checked,
        renderJavaScript: elements.renderJavaScript.checked
    };

    // Start download
    await startDownload(url, options);
}

/**
 * Start download via API
 */
async function startDownload(url, options) {
    try {
        // Update UI to loading state
        elements.downloadBtn.disabled = true;
        showProgress();
        updateProgress('Starting download...', 0, 0);

        // Call API
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url, options })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to start download');
        }

        currentDownloadId = data.downloadId;

        // Subscribe to progress updates
        subscribeToProgress(data.downloadId);

    } catch (error) {
        showError(error.message);
        elements.downloadBtn.disabled = false;
    }
}

/**
 * Subscribe to download progress via Socket.io
 */
function subscribeToProgress(downloadId) {
    const eventName = `download:${downloadId}`;

    socket.on(eventName, (data) => {
        handleProgressUpdate(data);
    });
}

/**
 * Handle progress update from socket
 */
function handleProgressUpdate(data) {
    switch (data.status) {
        case 'starting':
            updateProgress('Starting download...', 0, 0);
            break;

        case 'downloading':
            updateProgress(
                'Downloading files...',
                data.progress,
                data.filesDownloaded,
                data.currentFile
            );
            break;

        case 'rendering':
            updateProgress(
                '🚀 Rendering JavaScript...',
                data.progress,
                data.filesDownloaded,
                data.currentFile
            );
            break;

        case 'archiving':
            updateProgress('Creating ZIP archive...', 90, data.filesDownloaded);
            break;

        case 'completed':
            handleDownloadComplete(data);
            break;

        case 'error':
            showError(data.error || 'Download failed');
            break;

        case 'cancelled':
            resetUI();
            break;
    }
}

/**
 * Update progress UI
 */
function updateProgress(status, progress, filesCount, currentFile = '') {
    elements.progressStatus.textContent = status;
    elements.progressFiles.textContent = `${filesCount} files downloaded`;
    elements.progressBar.style.width = `${progress}%`;

    if (currentFile) {
        // Extract filename from path
        const filename = currentFile.split('/').pop().split('\\').pop();
        elements.progressCurrent.textContent = filename;
    } else {
        elements.progressCurrent.textContent = '';
    }
}

/**
 * Handle download completion
 */
function handleDownloadComplete(data) {
    hideProgress();
    showResult(data.zipFile, data.filesDownloaded);

    // Add to history
    addToHistory(elements.urlInput.value, data.zipFile);

    // Reset button
    elements.downloadBtn.disabled = false;
    currentDownloadId = null;
}

/**
 * Handle cancel button click
 */
async function handleCancel() {
    if (!currentDownloadId) return;

    try {
        await fetch(`/api/download/${currentDownloadId}`, {
            method: 'DELETE'
        });

        resetUI();
    } catch (error) {
        console.error('Failed to cancel:', error);
    }
}

/**
 * Show progress section
 */
function showProgress() {
    elements.progressSection.classList.remove('hidden');
    elements.resultSection.classList.add('hidden');
    elements.errorSection.classList.add('hidden');
}

/**
 * Hide progress section
 */
function hideProgress() {
    elements.progressSection.classList.add('hidden');
}

/**
 * Show result section
 */
function showResult(zipFile, filesCount) {
    elements.resultSection.classList.remove('hidden');
    elements.resultInfo.textContent = `${filesCount} files archived and ready to download`;
    elements.downloadLink.href = zipFile;
}

/**
 * Show error section
 */
function showError(message) {
    elements.errorSection.classList.remove('hidden');
    elements.progressSection.classList.add('hidden');
    elements.resultSection.classList.add('hidden');
    elements.errorMessage.textContent = message;
    elements.downloadBtn.disabled = false;
}

/**
 * Reset UI to initial state
 */
function resetUI() {
    elements.progressSection.classList.add('hidden');
    elements.resultSection.classList.add('hidden');
    elements.errorSection.classList.add('hidden');
    elements.progressBar.style.width = '0%';
    elements.downloadBtn.disabled = false;
    currentDownloadId = null;
}

/**
 * Validate URL format
 */
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Load download history from localStorage
 */
function loadHistory() {
    try {
        const saved = localStorage.getItem('downloadHistory');
        if (saved) {
            downloadHistory = JSON.parse(saved);
            renderHistory();
        }
    } catch (error) {
        console.error('Failed to load history:', error);
        downloadHistory = [];
    }
}

/**
 * Add item to download history
 */
function addToHistory(url, zipFile) {
    const item = {
        url,
        zipFile,
        timestamp: Date.now()
    };

    // Add to beginning
    downloadHistory.unshift(item);

    // Keep only last 5 items
    downloadHistory = downloadHistory.slice(0, 5);

    // Save to localStorage
    localStorage.setItem('downloadHistory', JSON.stringify(downloadHistory));

    // Update UI
    renderHistory();
}

/**
 * Render download history
 */
function renderHistory() {
    if (downloadHistory.length === 0) {
        elements.historySection.classList.add('hidden');
        return;
    }

    elements.historySection.classList.remove('hidden');

    elements.historyList.innerHTML = downloadHistory.map(item => {
        // Extract domain from URL
        let domain;
        try {
            domain = new URL(item.url).hostname;
        } catch {
            domain = item.url;
        }

        return `
      <li class="history-item">
        <span class="history-item-url" title="${item.url}">${domain}</span>
        <a href="${item.zipFile}" class="history-item-link" download>Download</a>
      </li>
    `;
    }).join('');
}
