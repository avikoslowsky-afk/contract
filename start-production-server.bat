@echo off
setlocal
cd /d "%~dp0"

set NODE_ENV=production
set REQUIRE_LOGIN=true
set COOKIE_SECURE=true
if not defined OCR_WORKER_CONCURRENCY set OCR_WORKER_CONCURRENCY=1

if not exist ".env" (
  echo ERROR: .env is missing.
  echo Copy .env.example to .env and have IT enter secure production values.
  exit /b 1
)

call start-windows-server.bat
