@echo off
setlocal
cd /d "%~dp0"

if not exist .env (
  copy .env.production.example .env >nul
  echo Created .env from .env.production.example.
  echo Review .env before production use.
)

docker compose up --build -d

echo.
echo Contract Operations is starting.
echo Open: http://SERVER-IP:4182/
echo.
echo Check logs with:
echo docker compose logs -f
pause
