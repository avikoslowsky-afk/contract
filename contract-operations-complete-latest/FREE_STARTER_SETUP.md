# Free Starter Setup

This starter keeps costs at zero while proving the workflow.

## Free Components

- App hosting: local computer or internal network computer
- Database: SQLite local database, upgrade to PostgreSQL later
- OCR: Tesseract OCR, free/open source
- File storage: ShareSync remains source of truth
- Search: local text search to start
- Exports: CSV files
- Alerts: local alert queue to start, email later

## Starter Workflow

1. Paste a ShareSync link or manually upload a PDF.
2. App creates a contract intake record.
3. OCR job is queued.
4. Tesseract can be connected for free OCR.
5. Extracted fields are saved for review.
6. User approves/edits fields.
7. Contract becomes searchable.
8. Renewal/termination alerts are tracked.

## Files

- `server.mjs`: free local backend API using built-in Node only.
- `data/contracts.sqlite`: local SQLite database for contract records and OCR jobs.
- `data/facilities.json`: starter facility records with bed counts.
- `data/vendors.json`: starter vendor records.
- `data/alerts.json`: starter renewal/exception alert queue.

## What Is Real vs Placeholder

Real now:

- Local backend structure
- Local SQLite database
- Contract/search API
- ShareSync link intake record
- OCR job queue
- Alerts data file

Needs connection:

- Real ShareSync download access
- Tesseract installation on the machine/server
- Real OCR parsing
- Real login/SSO
- Real email alerts

## Free OCR

Tesseract OCR is installed on this computer at:

```text
C:\Users\akoslowsky\AppData\Local\Programs\Tesseract-OCR\tesseract.exe
```

The backend is designed so a future OCR worker can run:

```text
tesseract input.pdf output -l eng
```

For scanned PDFs, you may also need a free PDF-to-image tool later, such as Poppler.

## Production Upgrade Path

After the free MVP works:

- JSON data -> PostgreSQL
- Tesseract -> Azure/AWS/Google OCR if needed
- Local auth -> Microsoft SSO/MFA
- Local server -> internal server/private cloud
- Local search -> Postgres full-text/OpenSearch
