# Pollux Chat

Clean, fast chat interface for Google Gemini AI. Runs locally or on any VPS.

## Features

- **Multi-chat support** — Create unlimited conversations, stored in IndexedDB
- **Streaming responses** — See AI typing in real-time
- **Image support** — Drag & drop, paste from clipboard, or click to upload
- **Model selection** — Dynamic model list from Google API
- **System prompts** — Optional per-chat system instructions
- **Edit & regenerate** — Edit your messages and regenerate responses
- **Export** — Download chats as Markdown
- **Dark/Light theme** — Auto-detects system preference
- **BYOK** — Bring your own API key, encrypted in browser
- **Privacy** — All data stored locally, nothing sent to our servers

## Tech Stack

- **Frontend:** React + Vite + Tailwind CSS
- **Backend:** Node.js + Express
- **AI:** Google Gemini API
- **Storage:** IndexedDB (Dexie.js)
- **Security:** Web Crypto API for key encryption

## Quick Start

### Prerequisites

- Node.js 20+
- Google AI API key ([get free](https://aistudio.google.com/app/apikey))

### Install & Run

```bash
# Install dependencies
npm run install:all

# Development mode
npm run dev

# Open http://localhost:5173
```

Enter your Google AI API key when prompted.

## Production Deployment

### Build

```bash
npm run build
```

### Run with PM2

```bash
# Install PM2
npm install -g pm2

# Configure environment (optional, for proxy)
cp server/.env.example server/.env
nano server/.env

# Start
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### Reverse Proxy

**Nginx:**

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Caddy:**

```
yourdomain.com {
    reverse_proxy localhost:3001
}
```

### SSL

- **Nginx:** `certbot --nginx -d yourdomain.com`
- **Caddy:** Automatic HTTPS

## Environment Variables

Create `server/.env`:

```env
# Server port (default: 3001)
PORT=3001

# Optional: Proxy for countries where Google API is blocked
HTTPS_PROXY=http://127.0.0.1:7890
```

## Project Structure

```
pollux-chat/
├── src/                    # React app
│   ├── App.tsx            # Main component
│   ├── lib/
│   │   ├── db.ts          # IndexedDB (Dexie)
│   │   └── crypto.ts      # API key encryption
│   └── hooks/
│       └── useTheme.ts    # Theme management
├── server/
│   └── server.js          # Express API
├── dist/                   # Production build
├── ecosystem.config.cjs    # PM2 config
└── package.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (client + API) |
| `npm run build` | Build for production |
| `npm start` | Run production server |
| `npm run install:all` | Install all dependencies |

## License

MIT
