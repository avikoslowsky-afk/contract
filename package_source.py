from datetime import datetime
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import hashlib
import json

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / f"contract-operations-github-clean-{datetime.now():%Y-%m-%d-%H%M%S}.zip"

# Unknown files and live data never enter this explicit source allowlist.
FILES = """
server.mjs renewal-email.mjs sharesync-folder-map.mjs package.json
app.js app-bootstrap.js app-business-config.js app-contracts-page.js
app-queues-page.js app-reports.js app-review-config.js index.html lite.html styles.css
assets/centers-health-care-logo.png assets/centers-health-care-letterhead.png
scripts/ocr_worker.py scripts/render_pdf_pages.py scripts/docx_to_text.py
scripts/excel_to_json.py scripts/smoke-test.mjs scripts/load-test.mjs
scripts/review-learning-test.mjs scripts/review-order-test.mjs
scripts/renewal-email-test.mjs scripts/preview-renewal-email.mjs
DEVELOPER_HANDOFF.md package_source.py
""".split()

SAFE_ENV = """HOST=127.0.0.1
PORT=4182
NODE_ENV=development
REQUIRE_LOGIN=true
ADMIN_USER=admin@example.com
ADMIN_PASSWORD=
COOKIE_SECURE=false
OCR_RESUME_ON_START=false
OCR_WORKER_CONCURRENCY=1
AI_AGENT_AUTO_SAVE=false
APP_BASE_URL=http://127.0.0.1:4182
SMTP_HOST=
SMTP_USER=
SMTP_PASS=
"""
IGNORE = """.env
.env.*
!.env.example
data/
uploads/
outputs/
tmp/
reset-backups/
manual-checkpoints/
node_modules/
__pycache__/
*.sqlite*
*.db
*.log
*.zip
*.csv
*.xlsx
contracts.json
ocr-jobs.json
facilities.json
served-*.json
dashboard-api.json
"""


def main():
    payload = {name: (ROOT / name).read_bytes() for name in FILES}
    payload['.env.example'] = SAFE_ENV.encode()
    payload['.gitignore'] = IGNORE.encode()
    manifest = {name: hashlib.sha256(content).hexdigest()
                for name, content in sorted(payload.items())}
    payload['SOURCE_MANIFEST.json'] = json.dumps(manifest, indent=2).encode()
    with ZipFile(OUT, 'x', ZIP_DEFLATED) as archive:
        for name, content in sorted(payload.items()):
            archive.writestr(name, content)
    with ZipFile(OUT) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == set(payload)
        for name, digest in manifest.items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == digest
    print(f'Created and verified: {OUT}')
    print(f'{len(payload)} files; {OUT.stat().st_size:,} bytes; no live data directories')


if __name__ == '__main__':
    main()
