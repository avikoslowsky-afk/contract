#!/usr/bin/env python3
import sys
from pathlib import Path

import pypdfium2 as pdfium
from PIL import ImageFilter, ImageOps


def main():
    if len(sys.argv) != 4:
        print("Usage: render_pdf_pages.py input.pdf output-dir max-pages", file=sys.stderr)
        return 2

    pdf_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    requested_pages = int(sys.argv[3])
    output_dir.mkdir(parents=True, exist_ok=True)

    document = pdfium.PdfDocument(str(pdf_path))
    page_total = len(document)
    pages_to_render = page_total if requested_pages <= 0 else min(page_total, max(1, requested_pages))

    for index in range(pages_to_render):
        page = document[index]
        bitmap = page.render(scale=3.2)
        image = bitmap.to_pil()
        image = ImageOps.grayscale(image)
        image = ImageOps.autocontrast(image, cutoff=1)
        image = image.filter(ImageFilter.SHARPEN)
        image.save(output_dir / f"page-{index + 1:04d}.png")

    print(f"{pages_to_render}/{page_total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
