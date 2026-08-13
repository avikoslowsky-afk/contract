@echo off
cd /d "%~dp0"
wscript.exe "%~dp0start-windows-hidden.vbs"
echo Contract Operations is starting in the background.
echo Open http://127.0.0.1:4182/
timeout /t 3 /nobreak >nul
