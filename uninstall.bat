@echo off
REM Sentinel CLI - uninstaller. Removes the global "sentinel" command.
REM Your project files in this folder are NOT touched.

echo Removing the global "sentinel" command (npm uninstall -g sentinelcli) ...
call npm uninstall -g sentinelcli

echo.
echo Done. The "sentinel" command has been removed.
echo.
echo Press any key to close this window . . .
pause >nul
