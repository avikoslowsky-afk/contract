from __future__ import annotations

from datetime import date
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / f"contract-operations-github-clean-{date.today().isoformat()}.zip"

EXCLUDED_DIRS = {
    ".git",
    ".agents",
    ".codex",
    "__pycache__",
    "node_modules",
    "uploads",
    "outputs",
    "reset-backups",
    "manual-checkpoints",
}

EXCLUDED_PREFIXES = {
    "data/backups",
    "data/ocr-worker-temp",
}

EXCLUDED_NAMES = {
    ".env",
    "Book1-vendor-master.xlsx",
    "Codex_Ready_Clean_Vendor_Workbook.xlsx",
}

EXCLUDED_SUFFIXES = {
    ".sqlite",
    ".sqlite-shm",
    ".sqlite-wal",
    ".db",
    ".log",
    ".zip",
}

EXCLUDED_GENERATED_PREFIXES = (
    "served-",
    "full-check",
    "lite-check",
    "page-check",
    "crash-check",
)

SAFE_DATA_FILES = {
    "data/facility_master_visible_starter.csv",
    "data/service_master_starter.csv",
}


def normalized(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def should_include(path: Path) -> bool:
    rel = normalized(path)
    parts = set(path.relative_to(ROOT).parts)

    if parts & EXCLUDED_DIRS:
        return False

    if any(rel.startswith(prefix + "/") for prefix in EXCLUDED_PREFIXES):
        return False

    if path.name in EXCLUDED_NAMES:
        return False

    if path.name.startswith(".env.") and path.name != ".env.example":
        return False

    if any(path.name.startswith(prefix) for prefix in EXCLUDED_GENERATED_PREFIXES):
        return False

    if any(rel.endswith(suffix) for suffix in EXCLUDED_SUFFIXES):
        return False

    if rel.startswith("data/"):
        return rel in SAFE_DATA_FILES

    return True


def main() -> None:
    if OUT.exists():
        OUT.unlink()

    included = 0
    skipped = 0

    with ZipFile(OUT, "w", ZIP_DEFLATED) as zf:
        for path in sorted(ROOT.rglob("*")):
            if not path.is_file():
                continue
            if should_include(path):
                zf.write(path, normalized(path))
                included += 1
            else:
                skipped += 1

    size_mb = OUT.stat().st_size / (1024 * 1024)
    print(f"Created: {OUT}")
    print(f"Included files: {included}")
    print(f"Skipped files: {skipped}")
    print(f"Size: {size_mb:.2f} MB")


if __name__ == "__main__":
    main()
