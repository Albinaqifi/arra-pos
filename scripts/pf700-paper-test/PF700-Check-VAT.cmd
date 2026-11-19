@echo off
setlocal
set "ARRA_PF700_RUNTIME=%LOCALAPPDATA%\Arra POS Offline Test\1.0.3\electron.exe"
set "ARRA_PF700_CHECK=%~dp0scripts\pf700-paper-test\check-vat.js"
if not exist "%ARRA_PF700_RUNTIME%" (
  echo Open the Arra 1.0.3 offline test on this Windows account first.
  pause
  exit /b 1
)
if not exist "%ARRA_PF700_CHECK%" (
  echo Extract the entire VAT check ZIP, then open PF700-Check-VAT.cmd.
  pause
  exit /b 1
)
echo Reading the PF700's current VAT rates on COM3.
set "ELECTRON_RUN_AS_NODE=1"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -Command "& $env:ARRA_PF700_RUNTIME $env:ARRA_PF700_CHECK --read-vat-rates | Out-Host; exit $LASTEXITCODE"
set "checkExit=%errorlevel%"
echo.
pause
exit /b %checkExit%
