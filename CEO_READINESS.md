# CEO Readiness Notes

This app should not be called production-ready until the Admin `CEO Readiness Checks` are green.

## Critical Items

1. Backend server must be running.
2. Database must be writable.
3. Upload folder must be writable.
4. Tesseract OCR must be installed on the server.
5. PDF renderer must be installed on the server.
6. For testing, sign-in can stay off with `REQUIRE_LOGIN=false`; before broader office use, set `REQUIRE_LOGIN=true` and configure `ADMIN_USER` and `ADMIN_PASSWORD`.
7. Admin -> Permissions must have named user accounts, roles, and disabled access for anyone who should no longer sign in.
8. Backups must work.
9. Restore must be tested.
10. SSO/MFA should be added before large company-wide use.

## OCR Standard

For executive/live readiness, test at least:

- one clean digital PDF
- one scanned PDF
- one bad scan
- one utility/account contract
- one lab/PPD contract
- one contract with signer/date

Every failed OCR job must show a clear reason in the Review Queue or Admin readiness table.

## Current OCR Design

The server now tries:

1. embedded PDF text through Poppler `pdftotext` when available
2. PDF page rendering through `pypdfium2` or Poppler
3. OCR through Tesseract
4. rule extraction
5. optional AI extraction through OpenAI or Ollama

This is the right structure for a practical first production test.
