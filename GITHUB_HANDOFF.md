# GitHub Handoff Checklist

## Before Uploading

- Confirm `.env` is not included.
- Confirm `data/*.sqlite` is not included.
- Confirm `uploads/`, `outputs/`, and `reset-backups/` are not included.
- Upload code, scripts, docs, starter CSV templates, and `.env.example`.

## What Another Developer Needs

- Node.js 24+
- Python 3
- Tesseract OCR
- Poppler
- Optional Ollama with `qwen2.5:3b`
- Access to the office ShareSync/storage plan if real contracts will be linked

## Next Smart Build Priorities

1. Make OCR review easier with source-highlighted field cards.
2. Improve AI extraction prompts by contract type.
3. Add clean master-data import for facilities, vendors, services, aliases, and bed counts.
4. Improve invoice-to-contract matching and exception reports.
5. Add real role permissions before office-wide use.
6. Move from SQLite to PostgreSQL before cloud or heavy multi-user usage.
7. Add daily automated backups before live production use.

## Cloud Recommendation

Use GitHub for collaboration.

For hosting:

- Internal office server: easiest now.
- Cloud later: use Render/Railway/Fly/Azure/AWS plus PostgreSQL and object storage.
- Vercel: okay for a frontend only, not ideal for this full OCR backend.

