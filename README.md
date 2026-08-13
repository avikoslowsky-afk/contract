# Contract Operations

Internal contract intelligence app for facility/vendor contracts.

## What It Does

- Upload contracts and invoices.
- OCR/read PDFs with local Tesseract/Poppler/Python tooling.
- Extract vendor, facility, service type, dates, renewal, payment terms, fees, insurance, and risk fields.
- Use local AI through Ollama when available.
- Review or auto-save high-confidence AI-reviewed contracts.
- Search contracts, facilities, vendors, categories, reports, and review queues.

## Local Windows Start

1. Install Node.js, Python, Tesseract OCR, Poppler, and optionally Ollama.
2. Copy `.env.example` to `.env`.
3. Edit `.env` for the local machine.
4. Run:

```bat
start-windows-server.bat
```

Then open:

```text
http://127.0.0.1:4182/
```

## Important Data Rules

Do not commit or upload:

- `.env`
- `data/*.sqlite`
- `uploads/`
- `outputs/`
- `reset-backups/`
- real contracts, invoices, PDFs, or passwords

Those are ignored by `.gitignore`.

## Cloud Note

This app is currently best for an internal Windows server or office network server.

Vercel is not the best fit for the full app because OCR, SQLite, uploaded files, Tesseract, Poppler, and long-running AI/OCR jobs need a persistent backend. For cloud use, plan a real backend host plus PostgreSQL and object storage.

