@echo off
setlocal
cd /d "%~dp0"

if not defined PORT set PORT=4182
if not defined HOST set HOST=127.0.0.1
if not defined OLLAMA_MODEL set OLLAMA_MODEL=llama3.1

echo Starting Contract Operations with free local AI...
echo.
echo Requirements:
echo   1. Install Ollama from https://ollama.com
echo   2. Run: ollama pull %OLLAMA_MODEL%
echo.
echo App URL:
echo   http://127.0.0.1:%PORT%/
echo.

node server.mjs
pause
