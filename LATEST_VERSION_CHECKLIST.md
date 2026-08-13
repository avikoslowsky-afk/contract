# Latest Version Checklist

This is the current internal-use version of the Contract Operations app.

## Included In This Folder

- Frontend app: `index.html`
- Backend server/API: `server.mjs`
- SQLite database: `data/contracts.sqlite`
- Upload folder: `uploads/`
- PDF rendering helper: `scripts/render_pdf_pages.py`
- Mac launcher: `start-mac-live.command`
- Windows launchers:
  - `start-windows.bat`
  - `start-windows-free-ai.bat`
  - `start-windows-server.bat`
- Internal network/firewall helpers:
  - `open-windows-firewall.bat`
  - `install-windows-startup-task.bat`
- Docker deployment:
  - `Dockerfile`
  - `docker-compose.yml`
  - `deploy-docker.sh`
  - `deploy-docker.bat`
- Setup docs:
  - `WINDOWS_SETUP.md`
  - `WINDOWS_SERVER_RUNBOOK.md`
  - `DEPLOYMENT.md`
  - `CEO_READINESS.md`

## OCR / PDF Stack

The app is built to use:

- embedded PDF text extraction through Poppler `pdftotext`
- PDF page rendering through `pypdfium2` or Poppler `pdftoppm`
- OCR through Tesseract
- optional AI extraction through OpenAI or local Ollama
- human review before extracted fields are approved

The zip includes the app code and Docker setup, but normal zip files do not carry installed system programs. On the computer/server running the app, install:

- Node.js
- Python
- Tesseract OCR
- Poppler PDF tools, strongly recommended
- optional Ollama for free local AI

Docker users can build the included Dockerfile, which installs Tesseract, Poppler, Python, and pypdfium2 inside the container.

## Current Access Mode

Sign-in is off for testing:

```text
REQUIRE_LOGIN=false
```

When ready to turn sign-in back on:

```text
REQUIRE_LOGIN=true
```

Then use Admin -> Permissions to add or disable people.

## Current Clean Data State

The included local database is reset for fresh testing:

- contracts: 0
- OCR jobs: 0
- invoices: 0
- tasks: 0
- one admin user exists for later sign-in mode

## What Is Real Now

- contract upload
- bulk upload
- OCR jobs
- review queue
- approved fields
- original PDF download
- delete/archive/restore contracts
- vendor profiles
- utility/account numbers
- invoice upload/matching
- weather check with real Open-Meteo data
- reports and CSV exports
- backup/restore
- user/access management
- saved tasks
- readiness checks

## Still A Deployment Decision

ShareSync copy behavior is not automatic yet. Uploaded PDFs currently save in the app upload folder. The next practical decision is whether every uploaded PDF should also be copied into a ShareSync folder automatically.
