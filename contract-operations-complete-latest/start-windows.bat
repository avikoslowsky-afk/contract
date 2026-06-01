@echo off
setlocal
cd /d "%~dp0"

if not defined PORT set PORT=4182
if not defined HOST set HOST=127.0.0.1

echo Starting Contract Operations...
echo.
echo App URL on this computer:
echo   http://127.0.0.1:%PORT%/
echo.
echo To share on the local network, run:
echo   set HOST=0.0.0.0
echo   start-windows.bat
echo.

node server.mjs
pause
