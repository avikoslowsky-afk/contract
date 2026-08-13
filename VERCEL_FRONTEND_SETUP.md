# Vercel Frontend + Office Computer Backend

This app can be split like this:

- **Vercel** serves the front page/app screen.
- **Your office computer/server** runs the backend, OCR, uploads, SQLite, Tesseract, Poppler, and AI.

Vercel alone cannot run the full OCR backend.

## What You Need

1. A GitHub repo with this app code.
2. A Vercel project connected to that repo.
3. Your office computer/server running `start-windows-server.bat`.
4. A secure public HTTPS tunnel to your backend, usually Cloudflare Tunnel or Tailscale Funnel.

Example:

```text
Vercel frontend:
https://contract-operations.vercel.app

Backend on your computer through tunnel:
https://contracts-backend.example.com
```

## How To Open The Vercel App Against Your Backend

Open the Vercel site with `apiBase`:

```text
https://contract-operations.vercel.app/?apiBase=https://contracts-backend.example.com
```

The app remembers that backend URL in the browser after the first visit.

## Important Security

Before exposing this outside the office network:

- Turn login on: `REQUIRE_LOGIN=true`
- Change `ADMIN_PASSWORD`
- Use HTTPS tunnel only
- Do not expose raw `http://192.168...` to the internet
- Keep backups enabled
- Do not commit `.env`, SQLite files, uploads, or contracts to GitHub

## Current Best Testing Flow

For now, easiest:

```text
http://192.168.251.19:4182/
```

That lets the intern use the full app on the office network.

Use Vercel only after you have a public HTTPS tunnel URL for the backend.

