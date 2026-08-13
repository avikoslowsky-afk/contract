@echo off
setlocal
cd /d "%~dp0"

set TASK_NAME=Contract Operations Server
set APP_DIR=%~dp0
set START_FILE=%APP_DIR%start-windows-hidden.vbs

echo This creates a Windows startup task for Contract Operations.
echo It starts the app hidden in the background after this Windows user logs in.
echo.

schtasks /Create /TN "%TASK_NAME%" /TR "wscript.exe \"%START_FILE%\"" /SC ONLOGON /F

echo.
echo Startup task created.
echo The app will start hidden after this Windows user logs in.
echo You can also start it now by double-clicking start-windows-hidden.bat.
pause
