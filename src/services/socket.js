const { startDownload, getDownloadStatus } = require('./downloader');

/**
 * Setup Socket.io event handlers
 */
function setupSocketHandlers(io) {
    io.on('connection', (socket) => {
        console.log(`Client connected: ${socket.id}`);

        // Legacy support for old client format
        socket.on('request', (data) => {
            console.log('Legacy request received:', data.token);

            // Generate new download ID
            const { v4: uuidv4 } = require('uuid');
            const downloadId = uuidv4();

            // Map old token to new download ID
            const options = {
                depth: 2,
                maxSize: 100,
                includeImages: true,
                includeStyles: true,
                includeScripts: true
            };

            // Start download
            startDownload(downloadId, data.website, options, io);

            // Forward events to old token format
            const forwardHandler = (event) => {
                let progress = event.status;

                if (event.status === 'completed') {
                    progress = 'Completed';
                    socket.emit(data.token, { progress, file: event.zipFile?.replace('/downloads/', '').replace('.zip', '') });
                } else if (event.status === 'archiving') {
                    progress = 'Converting';
                    socket.emit(data.token, { progress });
                } else {
                    socket.emit(data.token, { progress: `Downloading... ${event.filesDownloaded} files` });
                }
            };

            io.on(`download:${downloadId}`, forwardHandler);
        });

        // New download request format
        socket.on('download:start', (data) => {
            console.log('Download request:', data);
            // This is handled via REST API, but socket can subscribe to updates
        });

        // Subscribe to download updates
        socket.on('download:subscribe', (downloadId) => {
            console.log(`Client subscribing to: ${downloadId}`);
            socket.join(`download:${downloadId}`);
        });

        socket.on('disconnect', () => {
            console.log(`Client disconnected: ${socket.id}`);
        });
    });
}

module.exports = { setupSocketHandlers };
