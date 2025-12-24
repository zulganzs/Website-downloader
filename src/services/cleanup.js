const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = path.join(__dirname, '../../downloads');
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_STORAGE_MB = 1024; // 1GB max storage

/**
 * Start the cleanup scheduler
 */
function startCleanupScheduler() {
    // Ensure downloads directory exists
    if (!fs.existsSync(DOWNLOADS_DIR)) {
        fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    }

    // Run cleanup immediately on start
    cleanupOldDownloads();

    // Schedule periodic cleanup
    setInterval(cleanupOldDownloads, CLEANUP_INTERVAL_MS);

    console.log('📦 Cleanup scheduler started (runs every 15 minutes)');
}

/**
 * Clean up old download files
 */
function cleanupOldDownloads() {
    try {
        if (!fs.existsSync(DOWNLOADS_DIR)) {
            return;
        }

        const files = fs.readdirSync(DOWNLOADS_DIR);
        const now = Date.now();
        let deletedCount = 0;
        let freedBytes = 0;

        for (const file of files) {
            const filePath = path.join(DOWNLOADS_DIR, file);

            try {
                const stats = fs.statSync(filePath);
                const age = now - stats.mtimeMs;

                // Delete files older than MAX_AGE
                if (age > MAX_AGE_MS) {
                    if (stats.isDirectory()) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(filePath);
                    }

                    deletedCount++;
                    freedBytes += stats.size;
                }
            } catch (err) {
                console.warn(`Failed to cleanup: ${file}`, err.message);
            }
        }

        if (deletedCount > 0) {
            const freedMB = (freedBytes / (1024 * 1024)).toFixed(2);
            console.log(`🧹 Cleanup: Deleted ${deletedCount} old files (freed ${freedMB}MB)`);
        }

        // Check total storage usage
        checkStorageLimit();

    } catch (error) {
        console.error('Cleanup error:', error);
    }
}

/**
 * Check and enforce storage limit
 */
function checkStorageLimit() {
    try {
        if (!fs.existsSync(DOWNLOADS_DIR)) {
            return;
        }

        const files = fs.readdirSync(DOWNLOADS_DIR);
        const fileStats = [];
        let totalSize = 0;

        // Get all file sizes
        for (const file of files) {
            const filePath = path.join(DOWNLOADS_DIR, file);
            try {
                const stats = fs.statSync(filePath);
                totalSize += stats.size;
                fileStats.push({
                    path: filePath,
                    size: stats.size,
                    mtime: stats.mtimeMs,
                    isDir: stats.isDirectory()
                });
            } catch (err) {
                // Skip
            }
        }

        const totalMB = totalSize / (1024 * 1024);

        // If over limit, delete oldest files first
        if (totalMB > MAX_STORAGE_MB) {
            console.log(`⚠️ Storage limit exceeded: ${totalMB.toFixed(2)}MB / ${MAX_STORAGE_MB}MB`);

            // Sort by modification time (oldest first)
            fileStats.sort((a, b) => a.mtime - b.mtime);

            let freed = 0;
            const targetFree = (totalMB - MAX_STORAGE_MB * 0.8) * 1024 * 1024; // Free to 80% capacity

            for (const file of fileStats) {
                if (freed >= targetFree) break;

                try {
                    if (file.isDir) {
                        fs.rmSync(file.path, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(file.path);
                    }
                    freed += file.size;
                } catch (err) {
                    // Skip
                }
            }

            console.log(`🧹 Freed ${(freed / (1024 * 1024)).toFixed(2)}MB to stay under limit`);
        }

    } catch (error) {
        console.error('Storage check error:', error);
    }
}

/**
 * Get current storage usage
 */
function getStorageUsage() {
    try {
        if (!fs.existsSync(DOWNLOADS_DIR)) {
            return { usedMB: 0, maxMB: MAX_STORAGE_MB, percentage: 0 };
        }

        let totalSize = 0;
        const files = fs.readdirSync(DOWNLOADS_DIR);

        for (const file of files) {
            const filePath = path.join(DOWNLOADS_DIR, file);
            try {
                const stats = fs.statSync(filePath);
                totalSize += stats.size;
            } catch (err) {
                // Skip
            }
        }

        const usedMB = totalSize / (1024 * 1024);

        return {
            usedMB: Math.round(usedMB * 100) / 100,
            maxMB: MAX_STORAGE_MB,
            percentage: Math.round((usedMB / MAX_STORAGE_MB) * 100)
        };

    } catch (error) {
        return { usedMB: 0, maxMB: MAX_STORAGE_MB, percentage: 0 };
    }
}

module.exports = {
    startCleanupScheduler,
    cleanupOldDownloads,
    getStorageUsage
};
