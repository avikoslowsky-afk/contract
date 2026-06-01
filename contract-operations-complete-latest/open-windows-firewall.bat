@echo off
setlocal

if not defined PORT set PORT=4182

echo This opens Windows Firewall for Contract Operations on port %PORT%.
echo You may need to right-click this file and choose "Run as administrator".
echo.

netsh advfirewall firewall add rule name="Contract Operations %PORT%" dir=in action=allow protocol=TCP localport=%PORT%

echo.
echo Firewall rule added for port %PORT%.
pause
