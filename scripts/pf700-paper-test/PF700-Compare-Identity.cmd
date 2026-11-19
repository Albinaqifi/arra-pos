@echo off
setlocal
set "ARRA_ID_PAYLOAD=%~dp0."
if not exist "%ARRA_ID_PAYLOAD%\resources\app\src\desktop\pf700-checkout-exchange.ps1" set "ARRA_ID_PAYLOAD=%~dp0.."
if not exist "%ARRA_ID_PAYLOAD%\electron.exe" goto missing
if not exist "%ARRA_ID_PAYLOAD%\resources\app\src\desktop\pf700-checkout-exchange.ps1" goto missing
if not exist "%~dp0check-identity-layout.js" goto missing
if not exist "%~dp0compare-identity.ps1" goto missing
pushd "%ARRA_ID_PAYLOAD%" || goto missing
set "ELECTRON_RUN_AS_NODE=1"
echo PF700 identity comparison on COM3. This reads one reply.
echo Press Enter with a blank serial to cancel.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0compare-identity.ps1"
set "checkExit=%errorlevel%"
popd
pause
exit /b %checkExit%

:missing
echo Extract the entire comparison ZIP into the 1.0.4 payload folder or a folder directly inside it.
pause
exit /b 1
