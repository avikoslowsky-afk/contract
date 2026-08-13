# Contract Operations Safe Performance Audit

Date: 2026-07-08

## Rollback Checkpoint

Git is not installed on this workstation, so a Git commit named `before-contract-app-cleanup` could not be created.

Manual checkpoint created instead:

`manual-checkpoints/before-contract-app-cleanup-current/`

Files copied:

- `app.js`
- `server.mjs`
- `index.html`
- `styles.css`
- `package.json`

No features were removed during this pass.

## Pages / Workflows Found

- Dashboard
- Contracts / contract finder
- Upload
- OCR Queue
- Review Queue
- Exceptions
- Facilities
- Vendors
- Categories
- Renewals
- Compliance
- Tasks
- AI
- Clauses
- Finance
- Reports
- Weather Check
- Invoices
- Help
- Admin
- Login / sign out

## Core API Endpoints Found

- `/api/health`
- `/api/auth/status`
- `/api/login`
- `/api/logout`
- `/api/users`
- `/api/readiness`
- `/api/ai-status`
- `/api/sharesync-health`
- `/api/contracts`
- `/api/contracts/bulk-delete`
- `/api/contracts/repair-pdf-links`
- `/api/dashboard`
- `/api/facilities`
- `/api/vendors`
- `/api/vendor-profiles`
- `/api/categories`
- `/api/utility-accounts`
- `/api/tasks`
- `/api/exceptions`
- `/api/reports/cost`
- `/api/audit-logs`
- `/api/learning-rules`
- `/api/admin-settings`
- `/api/backup`
- `/api/backups`
- `/api/restore`
- `/api/weather-check`
- `/api/sharesync-intake`
- `/api/sharesync-scan`
- `/api/upload-contract`
- `/api/invoices`
- `/api/upload-invoice`
- `/api/upload-utility-accounts`
- `/api/upload-facility-master`
- `/api/upload-vendor-master`
- `/api/ocr-jobs`
- `/api/ocr-jobs/:id/run`
- `/api/alerts`
- `/api/alerts/send`

## Main Files

- `index.html`: page structure and navigation.
- `app.js`: front-end state, rendering, workflows, modals, review logic, invoice UI, reports.
- `server.mjs`: HTTP server, SQLite persistence, OCR, extraction, AI/Ollama integration, ShareSync, uploads, invoices, alerts.
- `styles.css`: UI styling.
- `scripts/render_pdf_pages.py`: PDF page rendering for OCR.
- `data/contracts.sqlite`: live database.
- `uploads/`: uploaded files.
- `outputs/`: generated files.

## Active Features To Preserve

- Contract upload
- ShareSync local path intake
- ShareSync folder scan
- OCR processing
- OCR Queue
- Review Queue
- Field correction
- Teaching / learning rules
- Vendor master matching
- Facility master matching and bed counts
- Contract approval
- Contract search
- Contract PDF opening
- Invoice upload and temporary matching
- Cost-per-bed calculations
- Finance reports
- Renewal and alert workflow
- User/admin settings
- Backups
- Weather checks
- Vendor cards
- Facility cards
- Reports export

## Performance Problems Found

1. The old browser tab was loading stale code: `freeze-fix-zero-10`.
2. The front end is a very large single file: `app.js` is about 570 KB.
3. Normal dashboard load was fetching too much live data.
4. `/api/ocr-jobs` payloads were large because each job can carry extracted fields, clauses, fee lines, and OCR preview text.
5. Contract list startup was pulling too many records for pages that do not need full contract data.
6. Queue pages rendered large sets of rows at once.
7. Several old `served-*` and `full-check-*` diagnostic files remain in the project. They are likely safe to archive later, but were not removed because this pass is non-destructive.

## Safe Improvements Already Applied

- Starter categories, facility seed data, vendor seed data, and contract templates moved from `app.js` into `app-bootstrap.js`.
- Report definitions moved from `app.js` into `app-reports.js`.
- Review checklist fields, primary review labels, and review dropdown options moved from `app.js` into `app-review-config.js`.
- Business configuration moved from `app.js` into `app-business-config.js`: category synonym groups, category group order, learned vendor requirement catalog, contract lifecycle statuses, and custom report columns.
- Contracts page renderer moved from `app.js` into `app-contracts-page.js`.
- Served app now uses `freeze-fix-zero-23` with `app-bootstrap.js`, then `app-reports.js`, then `app-review-config.js`, then `app-business-config.js`, then `app-contracts-page.js`, then `app.js`.
- OCR Queue backend pagination and lean list responses are active.
- OCR Queue no longer needs extracted fields, clauses, fee lines, or OCR previews just to draw the queue list.
- Vendor review guardrails were tightened so full contract sentence fragments are not treated as vendor names and cannot be saved as vendor cards.
- Dashboard no longer loads OCR job history.
- Contract startup uses compact contract records.
- Review Queue loads a smaller OCR working set.
- OCR Queue loads a capped OCR working set.
- OCR Queue renders fewer rows at once.
- Review/Upload/Contracts/OCR Queue/Vendors were browser-tested on `freeze-fix-zero-19`.
- `app.js`, `app-bootstrap.js`, `app-reports.js`, `app-review-config.js`, `app-business-config.js`, `app-contracts-page.js`, `public/app.js`, `public/app-reports.js`, `public/app-review-config.js`, `public/app-business-config.js`, and `public/app-contracts-page.js` passed JavaScript syntax checks on `freeze-fix-zero-23`.
- Dashboard, Review Queue, Contracts, Reports, Vendors, and OCR Queue were browser-tested on `freeze-fix-zero-23` with no app recovery screen and no console errors.
- Contracts Show All was tested on `freeze-fix-zero-23`; it rendered 10 rows on page 1 of 6 with no console errors.
- Browser console had no errors in the tested pages.
- No business logic was removed.
- No OCR logic was removed.
- No AI logic was removed.
- No upload/save/search/report workflows were removed.

## Current Test Status

Passed:

- `node --check app.js`
- `node --check app-bootstrap.js`
- `node --check app-reports.js`
- `node --check app-review-config.js`
- `node --check app-business-config.js`
- `node --check app-contracts-page.js`
- `node --check public/app.js`
- `node --check public/app-reports.js`
- `node --check public/app-review-config.js`
- `node --check public/app-business-config.js`
- `node --check public/app-contracts-page.js`
- `node --check server.mjs`
- Server health check
- Dashboard browser load
- Contracts browser load
- Upload browser load
- Review Queue browser load
- OCR Queue browser load

Not run:

- `npm install`
- `npm run lint`
- `npm run build`
- Full upload/OCR test in this audit pass
- Full invoice match test in this audit pass

Reason: this project currently runs as a custom Node server and does not appear to have a full modern build/lint pipeline in `package.json`.

## Safe Cleanup Plan

Safe to do next:

- Add a real Git checkpoint after Git is installed.
- Move old diagnostic `served-*`, `full-check-*`, `page-check-*`, and `lite-check-*` files into an archive folder after confirming they are not referenced.
- Continue splitting `app.js` gradually by feature: dashboard, contracts, review, upload, reports, invoices, admin.
- Add page-level lazy loading so heavy pages load only when opened.
- Add backend pagination to Review Queue.
- Add API timing logs for slow endpoints.
- Add a visible “loading” state on heavy pages.

Needs human review before changing:

- Removing any old diagnostic files.
- Changing review-field behavior.
- Changing AI learning behavior.
- Changing approval workflow.
- Changing ShareSync save behavior.
- Changing invoice approval or Basware integration.

Should remain untouched unless specifically requested:

- OCR extraction pipeline.
- Contract approval saves.
- Learning rules.
- ShareSync path safety checks.
- Database schema.
- Invoice-to-contract matching logic.
- Backup and restore endpoints.

## Basware Integration Recommendation

Basware can be connected later in one of four ways:

- API integration, if Basware provides API credentials.
- Scheduled invoice export from Basware into CSV/Excel/PDF.
- Shared mailbox intake where Basware emails invoice PDFs.
- Webhook where Basware posts invoice events to this app.

Recommended first version:

1. Import Basware invoice export or invoice PDF.
2. Match vendor, facility, invoice date, invoice total, PO/account/service line, and contract terms.
3. Return result as Approved, Needs Review, No Contract Match, Over Contract Rate, or Missing Contract Term.
4. Do not auto-approve until finance/legal confirms the rule thresholds.

## Remaining Risks

- No Git checkpoint because Git is not installed.
- `app.js` is still too large long-term, but five safe splits are complete: bootstrap/master data, report definitions, review configuration, business configuration, and the Contracts page renderer.
- `freeze-fix-zero-24` separates Review Queue from Review Detail. The queue now renders as a lightweight list, and Review Fields opens `#review-detail` for PDF/OCR/field editing. Browser check passed: Review Queue showed 12 items, Review Fields opened Review Detail with editable fields, Back to Queue returned to the list, and no client errors were captured.
- `freeze-fix-zero-25` splits the Review Queue and OCR Queue renderers into `app-queues-page.js`. Review Queue now renders 25 lightweight cards at a time, OCR Queue stays paginated at 25 jobs, and the main app delegates those pages instead of building all queue HTML inside `app.js`.
- `freeze-fix-zero-26` tightens review safety and ShareSync proof. Suspicious OCR guesses for vendor, dates, fees, and payment terms are left blank in Review Detail until a reviewer proves/saves them. Saving a vendor from Review Detail now also saves the Vendor field onto the contract and teaches the backend. Upload > ShareSync now has a Proof Test button backed by `/api/sharesync-proof` to confirm approved PDFs exist inside the configured ShareSync folder.
- `freeze-fix-zero-27` reduces Review Detail to six mandatory core fields: Contract type, Vendor Name, Effective date, Cost, Auto renew, and How to terminate. Duplicate labels such as Category/Service Type/Contract Type, Fee/Rate/Cost, and Notice/Termination now collapse into one review field, while vendor/service-specific fields stay optional unless intentionally added later.
- `freeze-fix-zero-28` reduces click lag on Dashboard/Contracts. Section changes now paint first and render after the click, Dashboard no longer scans full required-field profiles for every contract, and the dashboard finance panel uses lightweight counts instead of building peer/overpay comparisons until the Finance page is opened.
- `freeze-fix-zero-29` removes annualized spend parsing from normal Dashboard clicks. Dashboard now shows quick spend readiness and sends deeper money parsing to Finance/Reports, avoiding expensive OCR-money parsing during ordinary navigation.
- `freeze-fix-zero-30` makes facility bed counts explicit on the Facilities page. Facilities now show total beds, average beds, address coverage, per-facility bed count labels, and bed/system details inside the facility popup.
- `freeze-fix-zero-31` cleans duplicate facility rows by merging short names, full names, DBA/legal names, and aliases. Northern/St. Patrick variants now collapse into one richer facility profile with beds/address instead of showing duplicate empty rows.
- SQLite is acceptable for single-office/server use but should become PostgreSQL for heavier multi-user cloud use.
- Review Queue still needs deeper backend pagination for very large batches.
- Full production hardening still needs authentication, roles, backups, and server monitoring.
