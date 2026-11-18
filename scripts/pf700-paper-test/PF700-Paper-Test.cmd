@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pf700-paper-test\run-paper-test.ps1"
set "paperTestExit=%errorlevel%"
echo.
pause
exit /b %paperTestExit%
