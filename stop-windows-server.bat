@echo off
echo Stopping Contract Operations website and OCR worker...
for /f "tokens=5" %%P in ('netstat -a -n -o ^| findstr ":4182" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>nul
for /f "tokens=5" %%P in ('netstat -a -n -o ^| findstr ":4311" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>nul
echo Done.
timeout /t 2 /nobreak >nul
