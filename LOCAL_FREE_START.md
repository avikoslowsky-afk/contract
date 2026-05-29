# Local Free Start

The free starter backend is running in this session at:

- Website/API: `http://127.0.0.1:4180/`
- Health check: `http://127.0.0.1:4180/api/health`
- Contracts API: `http://127.0.0.1:4180/api/contracts`
- OCR jobs API: `http://127.0.0.1:4180/api/ocr-jobs`

The existing visual prototype is still available at:

- `http://127.0.0.1:4174/`

## What Is Set Up

1. Local backend server
   - File: `server.mjs`
   - Uses built-in Node only
   - No paid service

2. Local data storage
   - Folder: `data/`
   - Contracts, facilities, vendors, alerts, and OCR jobs are JSON files
   - Free starter replacement for a database

3. ShareSync intake endpoint
   - `POST /api/sharesync-intake`
   - Creates a contract record
   - Queues an OCR job

4. Contract search/list endpoint
   - `GET /api/contracts?page=1&pageSize=25&q=oxygen`
   - Paginates results

5. OCR job queue
   - `data/ocr-jobs.json`
   - Ready for Tesseract worker connection

## Next Free Build Step

Connect the visual prototype to this backend:

- Upload/Paste ShareSync link calls `/api/sharesync-intake`
- Contracts page calls `/api/contracts`
- Review Queue calls `/api/ocr-jobs`

Then add a Tesseract worker to process queued OCR jobs.
