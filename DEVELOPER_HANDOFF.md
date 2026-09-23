# Contract Operations: Developer Handoff

## GitHub update

Use a PRIVATE repository. Extract the ZIP and add its contents at your existing
repository root on a new branch. Review the diff before merging. Upload the
extracted source files, not just the ZIP, so GitHub can track code changes.
This is a source-only handoff, not a backup of working contracts.
It excludes credentials, uploaded contracts, databases, learning history,
exported reports, temporary files, and local machine scripts.
It retains application branding and business-specific source logic.
This ZIP does not remove previously committed sensitive files from Git history.

## Local setup

Install Node.js 24 or newer. In the extracted folder in PowerShell:

```powershell
Copy-Item .env.example .env
notepad .env
npm test
npm run check
npm start
```

Set ADMIN_USER and a strong, unique ADMIN_PASSWORD before starting.
Open http://127.0.0.1:4182/ on that computer. Choose another PORT in .env if busy.
Keep the terminal running. The package defaults to loopback access with login
required. Do not expose the development server publicly. Production requires
a separate security review, HTTPS, access controls and tested backups.

There are currently no npm dependencies. OCR also requires Python, Tesseract and
a PDF renderer. Inspect scripts/ocr_worker.py and scripts/render_pdf_pages.py
for requirements. Scanned PDF extraction needs those dependencies installed.
Email delivery is not configured by this package.

## Source layout

server.mjs is the HTTP/API/SQLite backend. Root index.html, app*.js and styles.css
are the active frontend. renewal-email.mjs builds notifications.
sharesync-folder-map.mjs maps known facility folder aliases.
The server creates its data directory on startup. This handoff contains no
existing contracts or learned corrections. Transfer live data separately using
an approved private backup process, never through GitHub.

## Review learning changes

Only missing or unapproved blank vendor, facility and category fields receive
learned suggestions. A whole normalized value must appear in the new document;
a matching sentence alone cannot justify copying an absent value. Empty and
repeated tokens cannot inflate evidence. Conflicting values are left for review,
independent of rule order. Confidence counts distinct source contract IDs.
Status, dates and fees are not copied by this learning function.
Human verification remains required; this is not a guarantee of OCR accuracy.

npm test runs learning, queue ordering and email regression tests. Learning tests
isolate the production decision function with stub helpers, not full OCR.
npm run check validates syntax. npm run smoke checks a running server's APIs.
Restart an existing backend to activate the code changes.

## Packaging

python package_source.py creates a timestamped source ZIP next to the project.
Only explicitly allowlisted files are included. Archive integrity and each
file's SHA-256 are verified against SOURCE_MANIFEST.json.
