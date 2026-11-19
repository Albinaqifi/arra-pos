@echo off
setlocal
if not [%1]==[] exit /b 2
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-pf700-identity.ps1"
set "identityResult=%errorlevel%"
pause
exit /b %identityResult%
