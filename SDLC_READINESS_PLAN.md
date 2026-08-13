# Contract App SDLC Readiness Plan

## 1. Requirements

Goal: build a private contract intelligence system for facilities, vendors, contracts, invoices, OCR, review, approvals, history, and reporting.

Core users:
- Contract/admin team uploading contracts and invoices.
- Operators searching facility/vendor contract information.
- Finance/AP reviewing invoice charges against contract terms.
- Leadership viewing risk, renewals, spend, and missing data.

Must-have workflows:
- Upload many contract PDFs.
- OCR contracts and extract major fields.
- Human review/approval before a contract becomes trusted.
- Keep current contracts separate from archived/history contracts.
- Maintain vendor profiles, mailing addresses, utility accounts, and contacts.
- Upload invoices separately from contracts for temporary matching.
- Match invoices to contract terms and flag exceptions without keeping the invoice as a permanent record unless that is added later.
- Search contracts, vendors, facilities, clauses, and invoices.
- Export reports.

## 2. Design

Current design:
- Single-page app in `index.html`.
- Local backend in `server.mjs`.
- SQLite database in `data/contracts.sqlite`.
- Uploaded files stored in `uploads/`.
- OCR uses PDF rendering plus Tesseract.

Design improvements still needed:
- Tighter role enforcement across every action, not only admin-only user management.
- Clear separation between test records and real office records.
- Temporary invoice check result for OCR text, match confidence, and exceptions. The current workflow does not keep invoice files as permanent records.
- A real document viewer with page references/highlights.
- Better audit trail for approvals, edits, archive/restore, and deletes. Partially added: upload, approve, archive/update, delete, and invoice upload events now save to local audit logs.

## 3. Development

Already built:
- Local server and SQLite storage.
- Contract upload, bulk upload, OCR, and review queue.
- Stronger OCR preprocessing.
- Contract archive/history.
- Vendor profiles and utility accounts inside vendor profile.
- Invoice upload section separated from contract upload.
- Temporary invoice check endpoint.
- Invoice OCR for PDF/image/text/CSV uploads without saving the invoice file permanently.
- Basic invoice-to-contract matching by vendor, facility, category, and OCR text.
- Local audit log table and audit events for major actions.
- Dashboard workflow path.
- Original PDF download.
- Delete and archive actions.
- Live login with database-backed users, hashed passwords, roles, and active/disabled access.
- Real task creation, status updates, and delete.

Next development priorities:
- Invoice line-item extraction.
- Stronger contract-to-invoice matching logic with user confirmation.
- Editable approved contract fields saved back to DB.
- Source proof with page/snippet for every extracted field.
- Facility/vendor duplicate detection.
- Better category-specific fields, such as utility kWh, gas therms, oxygen rate, laundry per lb, waste pickup frequency.

## 4. Testing

Needed test cases:
- Upload one clean PDF contract.
- Upload one scanned PDF contract.
- Upload 20+ contracts in bulk.
- Upload invalid file type.
- OCR fails gracefully and shows a useful message.
- Approve extracted fields and confirm saved contract updates.
- Archive and restore a contract.
- Delete a test contract and confirm PDF/job cleanup.
- Upload invoice PDF and confirm OCR text is captured, matched, and not kept as a permanent invoice document unless that policy changes.
- Match invoice to correct vendor/facility/contract and show confidence/reason.
- Search for current contracts only.
- Search including archived/history contracts.

Before live use, add:
- Automated backend endpoint tests.
- Browser workflow tests for upload, review, approve, archive, and invoice upload.
- Test database seed with fake data only.

## 5. Deployment

Current state:
- Runs locally on one Mac and can run on one internal office server.
- Good for internal pilot testing after the server is restarted with the current code.
- Not ready for public internet.

Live deployment should be:
- Private network, VPN, or zero-trust access only.
- Real authentication with SSO/MFA.
- Server process manager so the app stays running.
- Backups for SQLite/uploads or migration to managed database/storage.
- Environment variables for OCR/AI settings.
- HTTPS.

## 6. Maintenance

Needed before production:
- Daily backups.
- Error logs.
- Upload/OCR job monitoring.
- Admin tools for failed OCR jobs.
- Versioned release notes.
- Database migration scripts.
- Regular security updates.

## 7. Security And Compliance

Current risks:
- Built-in login is good for internal pilot use, but SSO/MFA is still better for larger company-wide use.
- Files are stored locally without encryption controls.
- Audit trail is started for major actions, but every field edit still needs tracked before production.
- No automatic backup/restore plan.

Production requirements:
- Real login.
- Role-based permissions.
- Audit logs.
- Private network access.
- Encrypted backups.
- Clear retention policy for old contracts/invoices.
- Approval history for legal/finance changes.

## Practical Go-Live Decision

Status: internal MVP moving toward live office pilot.

Safe for:
- Local testing.
- OCR experiments.
- Building the data model.
- Internal pilot testing on a private office network.

Not yet safe for:
- Public internet.
- Real company-wide access.
- Sole source of truth for legal contracts.
- Finance/AP automation without human review.

Recommended next sprint:
1. Add invoice line-item extraction.
2. Add field edit/save for approved contract records.
3. Expand audit log to every field edit.
4. Add stricter permission checks for each role.
5. Add browser tests for upload, OCR, review, reports, users, and delete flows.
6. Decide and implement ShareSync copy behavior for uploaded PDFs.
