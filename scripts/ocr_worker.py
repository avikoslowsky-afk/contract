import json
import os
import re
import subprocess
import tempfile
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pypdfium2 as pdfium


HOST = os.environ.get("OCR_WORKER_HOST", "127.0.0.1")
PORT = int(os.environ.get("OCR_WORKER_PORT", "4311"))
TESSERACT_PATH = os.environ.get(
    "TESSERACT_PATH",
    str(Path.home() / "AppData" / "Local" / "Programs" / "Tesseract-OCR" / "tesseract.exe"),
)
PDFTOTEXT_PATH = os.environ.get("PDFTOTEXT_PATH", "")
MAX_PAGES = int(os.environ.get("OCR_MAX_PDF_PAGES", "0") or "0")
APP_ROOT = Path(__file__).resolve().parents[1]
WORKER_TEMP_DIR = Path(os.environ.get("OCR_WORKER_TEMP_DIR", APP_ROOT / "uploads" / "ocr-worker-temp"))
WORKER_TEMP_DIR.mkdir(parents=True, exist_ok=True)


def clean_text(text):
    return "\n".join(line.rstrip() for line in str(text or "").splitlines()).strip()


def text_layer_is_corrupt(text):
    value = str(text or "")
    if not value.strip():
        return True
    bad_chars = sum(1 for ch in value if ord(ch) < 32 and ch not in "\n\r\t")
    private_chars = sum(1 for ch in value if 0xE000 <= ord(ch) <= 0xF8FF or ch == "\ufffd")
    strange_chars = sum(1 for ch in value if not (ch in "\n\r\t" or 32 <= ord(ch) <= 126 or ch in "\u00a0\u2010\u2011\u2012\u2013\u2014\u2015\u2018\u2019\u201c\u201d\u2022\u2026"))
    odd_runs = len(re.findall(r"[^\x09\x0A\x0D\x20-\x7E]{3,}", value))
    readable_chars = sum(1 for ch in value if ch.isascii() and (ch.isalnum() or ch in "$%.,:/() -_\n\r\t"))
    letters = sum(1 for ch in value if ch.isascii() and ch.isalpha())
    word_hits = len(re.findall(r"\b(agreement|contract|vendor|facility|service|term|payment|invoice|notice|effective|terminate|fee|rate|charge|client|customer|provider)\b", value, re.I))
    length = max(len(value), 1)
    return (
        bad_chars >= 2
        or private_chars >= 3
        or (bad_chars + private_chars) / length > 0.025
        or strange_chars / length > 0.035
        or odd_runs >= 3
        or (len(value) > 250 and readable_chars / length < 0.55)
        or (len(value) > 250 and letters < 25)
        or (len(value) > 750 and word_hits < 2 and strange_chars / length > 0.015)
    )


def run_command(args, timeout=120):
    completed = subprocess.run(
        args,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "OCR command failed").strip())
    return completed.stdout


def extract_embedded_pdf_text(source_path):
    if not PDFTOTEXT_PATH or not Path(PDFTOTEXT_PATH).exists():
        return ""
    try:
        text = run_command([PDFTOTEXT_PATH, "-layout", "-enc", "UTF-8", source_path, "-"], timeout=90)
        text = clean_text(text)
        if len(text) < 250 or text_layer_is_corrupt(text):
            return ""
        return f"--- Embedded PDF Text ---\n{text}"
    except Exception:
        return ""


def ocr_image(image_path):
    return run_command([
        TESSERACT_PATH,
        image_path,
        "stdout",
        "-l",
        "eng",
        "--oem",
        "1",
        "--psm",
        os.environ.get("OCR_TESSERACT_PSM", "1"),
        "-c",
        "preserve_interword_spaces=1",
        "-c",
        "user_defined_dpi=300",
    ], timeout=180)


def extract_pdf_text(source_path, max_pages=MAX_PAGES):
    embedded = extract_embedded_pdf_text(source_path)
    pages = []
    temp_files = []
    pdf = pdfium.PdfDocument(source_path)
    try:
        total_pages = len(pdf)
        limit = total_pages if max_pages <= 0 else min(total_pages, max_pages)
        run_id = uuid.uuid4().hex
        for index in range(limit):
            page = pdf[index]
            bitmap = page.render(scale=200 / 72)
            image = bitmap.to_pil()
            image_path = WORKER_TEMP_DIR / f"ocr-{run_id}-page-{index + 1}.png"
            image.save(image_path)
            temp_files.append(image_path)
            text = clean_text(ocr_image(str(image_path)))
            pages.append(f"--- Page {index + 1} ---\n{text}")
        limited = ""
        if max_pages > 0 and total_pages > max_pages:
            limited = f"\n\n[OCR limited to first {max_pages} of {total_pages} pages. Set OCR_MAX_PDF_PAGES to raise this limit.]"
        body = "\n\n".join(part for part in [embedded, *pages] if part).strip()
        return f"{body}\n\n[PDF rendered with Python OCR worker.]{limited}".strip()
    finally:
        for item in temp_files:
            try:
                item.unlink(missing_ok=True)
            except Exception:
                pass


def extract_file_text(source_path, max_pages=MAX_PAGES):
    source_path = str(source_path or "").strip().strip("\"'")
    ext = Path(source_path).suffix.lower()
    if ext in {".txt", ".text", ".md", ".csv"}:
        return Path(source_path).read_text(encoding="utf-8", errors="ignore")
    if ext == ".pdf":
        return extract_pdf_text(source_path, max_pages=max_pages)
    return clean_text(ocr_image(source_path))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_json({"ok": True, "worker": "python-ocr", "tesseract": TESSERACT_PATH})
            return
        self.send_json({"error": "Not found"}, status=404)

    def do_POST(self):
        if self.path != "/ocr":
            self.send_json({"error": "Not found"}, status=404)
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            source_path = payload.get("path") or payload.get("localFilePath")
            if not source_path:
                self.send_json({"error": "Missing file path"}, status=400)
                return
            source_path = str(Path(str(source_path).strip().strip("\"'")))
            if not Path(source_path).exists():
                self.send_json({"error": f"File not found: {source_path}"}, status=404)
                return
            max_pages = int(payload.get("maxPages", MAX_PAGES) or 0)
            text = extract_file_text(source_path, max_pages=max_pages)
            self.send_json({"ok": True, "text": text, "length": len(text)})
        except Exception as error:
            self.send_json({"error": str(error)}, status=500)

    def log_message(self, *_args):
        return

    def send_json(self, value, status=200):
        data = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Python OCR worker listening at http://{HOST}:{PORT}", flush=True)
    server.serve_forever()
