FROM node:24-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    poppler-utils \
    python3 \
    python3-pip \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --break-system-packages --no-cache-dir pypdfium2

COPY . .

ENV HOST=0.0.0.0
ENV PORT=4182
ENV TESSERACT_PATH=/usr/bin/tesseract
ENV PDFTOPPM_PATH=/usr/bin/pdftoppm
ENV PDFINFO_PATH=/usr/bin/pdfinfo
ENV PYTHON_PATH=/usr/bin/python3

EXPOSE 4182

CMD ["node", "server.mjs"]
