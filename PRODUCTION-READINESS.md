# Contract Operations Production Readiness

## Deployment boundary

Run the Node server on a managed Windows server. Put it behind an IT-managed HTTPS reverse proxy and restrict access to the company network or VPN. Do not expose port 4182 directly to the public internet.

## Required configuration

1. Copy `.env.example` to `.env`.
2. Replace the sample administrator username and password.
3. Set `APP_BASE_URL` to the final HTTPS address.
4. Configure SMTP through IT.
5. Confirm the ShareSync root is accessible by the Windows service account.
6. Start with `start-production-server.bat`.

Production mode requires login and secure cookies. Secure cookies require HTTPS. Continue using `start-windows-server.bat` for local development and office demonstrations that do not use HTTPS.

## OCR queue

Uploads are saved first and queued in SQLite. The server processes OCR jobs with controlled concurrency. `OCR_WORKER_CONCURRENCY=1` is recommended until IT measures CPU and memory. Queued or interrupted jobs resume after restart.

## Operations checks

- `npm.cmd run check`: syntax validation.
- `npm.cmd run smoke`: core endpoint health test.
- `npm.cmd run load-test`: read-only concurrent request test.
- `/api/health`: public service readiness without contract data.
- `/api/metrics`: admin-only counts, latency, database size, and OCR queue depth.

## Backup and recovery

Create a backup before large imports. IT should schedule database and upload-folder backups, retain multiple restore points, and test restoration on a separate machine. ShareSync source files remain the authoritative document cabinet.

## Scale boundary

SQLite remains appropriate for a single application server and a controlled office pilot. Before multi-server deployment or sustained high write concurrency, migrate the database layer to PostgreSQL. Reports should continue moving toward SQL-native aggregate queries so they do not parse every contract JSON record.
