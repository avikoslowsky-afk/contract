# Local Live Start

The local live backend normally runs at:

- Website/API: `http://127.0.0.1:4182/`
- Health check: `http://127.0.0.1:4182/api/health`
- Contracts API: `http://127.0.0.1:4182/api/contracts`
- OCR jobs API: `http://127.0.0.1:4182/api/ocr-jobs`

Use the server URL, not the raw `index.html` file, when testing uploads, OCR, login, users, reports, backups, weather, and deletes.

The raw HTML file is only useful for a visual preview and cannot run backend features.

## What Is Set Up

1. Local backend server
   - File: `server.mjs`
   - Uses built-in Node only
   - No paid service

2. Local data storage
   - Database: `data/contracts.sqlite`
   - Contracts and OCR jobs are stored in SQLite
   - Real users, contracts, tasks, invoices, OCR jobs, vendor profiles, and audit logs are stored in SQLite

3. ShareSync intake endpoint
   - `POST /api/sharesync-intake`
   - Creates a contract record
   - Queues an OCR job

4. Contract search/list endpoint
   - `GET /api/contracts?page=1&pageSize=25&q=oxygen`
   - Paginates results

5. OCR job queue
   - Table: `ocr_jobs`
   - Runs Tesseract OCR and stores extracted text previews

## Next Live Build Step

Decide whether uploaded contract PDFs should stay in the app upload folder, copy into a ShareSync folder, or both.
