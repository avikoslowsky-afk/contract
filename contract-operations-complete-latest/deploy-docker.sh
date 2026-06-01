#!/bin/sh
set -e

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.production.example .env
  echo "Created .env from .env.production.example."
  echo "Review .env before production use."
fi

docker compose up --build -d

echo ""
echo "Contract Operations is starting."
echo "Open: http://SERVER-IP:${PORT:-4182}/"
echo ""
echo "Check logs with:"
echo "docker compose logs -f"
