# GitHub Upload Guide

Use this guide when you are ready to put the app code on GitHub.

## Use the Clean Package

Upload the clean project files only. Do not upload your local database, real contracts, backups, or API keys.

Safe files to upload:

- `index.html`
- `server.mjs`
- `scripts/`
- `WINDOWS_SETUP.md`
- `FREE_STARTER_SETUP.md`
- `LOCAL_FREE_START.md`
- `SDLC_READINESS_PLAN.md`
- `start-windows.bat`
- `start-windows-free-ai.bat`
- `start-local-network.command`
- `start-local-free-ai.command`
- `.env.example`
- `.gitignore`

Do not upload:

- `data/contracts.sqlite`
- `data/contracts.sqlite-shm`
- `data/contracts.sqlite-wal`
- `data/backups/`
- `uploads/`
- `.env`
- real PDFs
- API keys
- private vendor/facility/account data

The `.gitignore` file is already set up to block the private files above.

## Recommended Upload Steps

1. Create a new private GitHub repository.
2. Use the clean zip or clean folder, not the full local data copy.
3. Upload the files listed in the safe list.
4. Confirm GitHub does not show `uploads/`, `data/contracts.sqlite`, `data/backups/`, or `.env`.
5. Tell Windows users to follow `WINDOWS_SETUP.md`.

## After Downloading on Windows

Windows users should:

1. Install Node.js LTS.
2. Install Python.
3. Install Tesseract OCR.
4. Optional: install Ollama and run `ollama pull llama3.1`.
5. Double-click `start-windows.bat` or `start-windows-free-ai.bat`.

## Production Note

For real work use, keep the GitHub repository private and run the app on one internal work server/computer. Everyone else should connect to that server URL in the browser.
