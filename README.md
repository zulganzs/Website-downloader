# Website Downloader v2.0 🌐

Download the complete source code of any website including all assets.

![Website Downloader](https://img.shields.io/badge/version-2.0.0-blue)
![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## ✨ Features

- **🔒 Secure Downloads** - URL validation, no shell injection vulnerabilities
- **⚡ Real-time Progress** - Live updates via Socket.io
- **🎨 Modern UI** - Dark glassmorphic design with responsive layout
- **📁 Smart Crawling** - Configurable depth, file type filtering
- **🧹 Auto Cleanup** - Downloads automatically deleted after 1 hour
- **🚀 Rate Limiting** - Built-in protection against abuse

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# Open in browser
http://localhost:3000
```

## 📖 API Reference

### Start Download
```
POST /api/download
Content-Type: application/json

{
  "url": "https://example.com",
  "options": {
    "depth": 2,
    "includeImages": true,
    "includeStyles": true,
    "includeScripts": true
  }
}
```

### Get Download Status
```
GET /api/download/:id
```

### Cancel Download
```
DELETE /api/download/:id
```

### List All Downloads
```
GET /api/downloads
```

## 🛠 Tech Stack

- **Backend**: Node.js, Express, Socket.io v4
- **Frontend**: Vanilla JS, Modern CSS
- **Security**: Helmet, Express Rate Limit
- **Crawling**: node-fetch, cheerio

## 📁 Project Structure

```
├── src/
│   ├── server.js           # Express server with security
│   ├── routes/
│   │   └── api.js          # REST API endpoints
│   └── services/
│       ├── downloader.js   # Website crawler
│       ├── socket.js       # Socket.io handlers
│       └── cleanup.js      # Auto cleanup scheduler
├── public/
│   ├── index.html          # Modern UI
│   ├── css/style.css       # Dark theme styles
│   └── js/app.js           # Frontend logic
└── downloads/              # Temporary storage
```

## 🔒 Security Features

- **URL Validation** - Only http/https allowed
- **Private IP Blocking** - localhost, 127.x, 192.168.x blocked
- **Rate Limiting** - 100 requests per 15 minutes
- **Security Headers** - Helmet.js protection
- **No Shell Commands** - Pure Node.js implementation

## ⚙️ Configuration

Environment variables (optional):
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode

## 📝 License

MIT License - feel free to use and modify!
