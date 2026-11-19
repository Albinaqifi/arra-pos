@echo off
set "ARRA_ROUTINE_SCRIPT=%~dp0start-routine-pf700.ps1"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ARRA_ROUTINE_SCRIPT%"
pause
