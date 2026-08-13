@echo off
setlocal

set TARGET=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Contract Operations Hidden.vbs

if exist "%TARGET%" del "%TARGET%"

echo Contract Operations hidden startup entry removed.
pause
