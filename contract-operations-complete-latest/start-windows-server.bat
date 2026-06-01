@echo off
setlocal
cd /d "%~dp0"

set HOST=0.0.0.0
if not defined PORT set PORT=4182

echo Starting Contract Operations as a work-network server...
echo.
echo This computer will host the app for other computers on the same network.
echo.
echo On this computer:
echo   http://127.0.0.1:%PORT%/
echo.
echo From another work computer:
echo   http://THIS-COMPUTER-IP:%PORT%/
echo.
echo If other computers cannot connect, run open-windows-firewall.bat as Administrator.
echo.

node server.mjs
pause
