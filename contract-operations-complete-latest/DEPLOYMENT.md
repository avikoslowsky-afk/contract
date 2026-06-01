# Deployment Guide

If you want to use this app from anywhere, do not upload only `index.html`.

This is a full app with:

- website frontend
- backend server
- SQLite database
- OCR processing
- optional AI
- uploaded contract files
- backups

## Most Important Point

Tesseract OCR cannot live inside a normal static website by itself.

For real OCR, Tesseract must be installed on the server that runs the backend.

The included `Dockerfile` packages the app with:

- Node.js
- Tesseract OCR
- Poppler PDF tools
- Python
- pypdfium2 PDF renderer

That means the server/container can read PDFs and scanned contracts without needing Tesseract on every user's computer.

## Best Production Shape

Use one hosted/internal server:

```text
Users' browsers -> app website -> backend server -> Tesseract/OCR + database + AI
```

Users do not install OCR. They just open the website.

## Docker Build

From the app folder:

```bash
docker build -t contract-operations .
```

## Docker Run

Copy `.env.production.example` to `.env` first. For testing, sign-in is off by default. Later, when you want sign-in back on, change:

```text
REQUIRE_LOGIN=true
ADMIN_USER=your.admin@company.com
ADMIN_PASSWORD=use-a-long-private-password
```

```bash
docker run -p 4182:4182 \
  --env-file .env \
  -v contract-data:/app/data \
  -v contract-uploads:/app/uploads \
  contract-operations
```

Then open:

```text
http://SERVER-IP:4182/
```

## Easier Docker Compose Deploy

The project also includes:

- `docker-compose.yml`
- `.env.production.example`
- `deploy-docker.sh`
- `deploy-docker.bat`

On Windows Server or a Windows work computer with Docker Desktop installed, double-click:

```text
deploy-docker.bat
```

On Linux/macOS server:

```bash
chmod +x deploy-docker.sh
./deploy-docker.sh
```

This builds the app, starts it in the background, and keeps the database/uploads in Docker volumes.

To stop it:

```bash
docker compose down
```

To see logs:

```bash
docker compose logs -f
```

## AI Options

### Free Local AI

Ollama should run beside the app on the server.

Set:

```bash
OLLAMA_URL=http://host.docker.internal:11434
OLLAMA_MODEL=llama3.1
```

### Paid AI

Set:

```bash
OPENAI_API_KEY=your-key
```

Never put real keys in GitHub.

## What Not To Put On Public GitHub

- real contracts
- uploaded PDFs
- `data/contracts.sqlite`
- backups
- `.env`
- API keys
- real vendor/facility/account data

## What A Hosting Provider Needs

Use a host that supports a backend/container, not just static HTML.

Good fit:

- internal Windows/Linux server
- Docker host
- private cloud server
- Azure App Service for Containers
- AWS/GCP container service

Not enough by itself:

- static website hosting only
- GitHub Pages only
- drag-and-drop HTML hosting

Those cannot run Tesseract OCR.
