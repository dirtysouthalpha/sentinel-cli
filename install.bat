@echo off
REM Sentinel CLI - one-click installer for Windows.
REM Just double-click this file. It builds the project and installs the
REM global "sentinel" command. Requires Node.js 20+ (https://nodejs.org).

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"

echo.
echo Press any key to close this window . . .
pause >nul
