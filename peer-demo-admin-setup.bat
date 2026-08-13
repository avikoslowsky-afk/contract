@echo off
setlocal

if not defined PORT set PORT=4182

echo Contract Operations peer demo setup
echo.
echo This should be run as administrator.
echo It opens Windows Firewall for the app and keeps this server computer awake.
echo.

netsh advfirewall firewall add rule name="Contract Operations %PORT%" dir=in action=allow protocol=TCP localport=%PORT%

powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0

echo.
echo Done.
echo.
echo Staff on the same office network should open:
echo   http://192.168.251.19:%PORT%/
echo.
pause
