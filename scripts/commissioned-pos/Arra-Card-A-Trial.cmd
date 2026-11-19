@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0program\start-supervised-pf700.ps1" -StartCardTrial
set "result=%errorlevel%"
if not "%result%"=="0" pause
exit /b %result%
