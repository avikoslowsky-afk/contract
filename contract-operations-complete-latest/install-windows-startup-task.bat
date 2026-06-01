@echo off
setlocal
cd /d "%~dp0"

set TASK_NAME=Contract Operations Server
set APP_DIR=%~dp0
set START_FILE=%APP_DIR%start-windows-server.bat

echo This creates a Windows startup task for Contract Operations.
echo Run as Administrator on the computer/server that should host the app.
echo.

schtasks /Create /TN "%TASK_NAME%" /TR "\"%START_FILE%\"" /SC ONSTART /RL HIGHEST /F

echo.
echo Startup task created.
echo The app will start after this computer restarts.
echo You can also start it now by double-clicking start-windows-server.bat.
pause
