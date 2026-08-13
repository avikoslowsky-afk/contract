@echo off
setlocal
cd /d "%~dp0"

if not defined PORT set PORT=4182
if not defined HOST set HOST=0.0.0.0
if not defined REQUIRE_LOGIN set REQUIRE_LOGIN=false
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.16.0-win-x64\node.exe" set NODE_EXE=%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.16.0-win-x64\node.exe
if not defined NODE_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
if not defined NODE_EXE set NODE_EXE=node

if not defined TESSERACT_PATH if exist "%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe" set TESSERACT_PATH=%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe
if not defined PDFTOPPM_PATH if exist "%LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\poppler-25.07.0\Library\bin\pdftoppm.exe" set PDFTOPPM_PATH=%LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\poppler-25.07.0\Library\bin\pdftoppm.exe
if not defined PDFINFO_PATH if exist "%LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\poppler-25.07.0\Library\bin\pdfinfo.exe" set PDFINFO_PATH=%LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\poppler-25.07.0\Library\bin\pdfinfo.exe
if not defined PDFTOTEXT_PATH if exist "%LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\poppler-25.07.0\Library\bin\pdftotext.exe" set PDFTOTEXT_PATH=%LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\poppler-25.07.0\Library\bin\pdftotext.exe

if exist "data" attrib -R "data" /S /D
if exist "uploads" attrib -R "uploads" /S /D

echo Starting Contract Operations backend...
echo.
echo App URL:
echo   http://127.0.0.1:%PORT%/
echo   http://192.168.251.19:%PORT%/  (office network)
echo.
echo Login mode:
echo   REQUIRE_LOGIN=%REQUIRE_LOGIN%
echo.
echo OCR:
echo   TESSERACT_PATH=%TESSERACT_PATH%
echo.

"%NODE_EXE%" server.mjs
echo.
echo Server stopped. Leave this window open while using the app.
pause
