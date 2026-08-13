@echo off
setlocal
cd /d "%~dp0"

if not defined PORT set PORT=4175

echo Starting Contract Operations in view-only fallback mode...
echo.
echo URL:
echo   http://127.0.0.1:%PORT%/
echo.
echo This mode does not run the backend database, OCR, upload processing, backups, or login.
echo Use this only when Node.js is not available.
echo.

python -m http.server %PORT% --bind 127.0.0.1
pause
