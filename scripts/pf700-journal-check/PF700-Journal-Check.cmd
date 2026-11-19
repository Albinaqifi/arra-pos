@echo off
setlocal
set "ARRA_PF700_RUNTIME=%LOCALAPPDATA%\Arra POS Offline Test\1.0.3\electron.exe"
set "ARRA_PF700_JOURNAL=%~dp0scripts\pf700-journal-check\journal-check.js"
if not exist "%ARRA_PF700_RUNTIME%" (
  echo The Arra 1.0.3 offline test runtime is required on this Windows account.
  pause
  exit /b 1
)
if not exist "%ARRA_PF700_JOURNAL%" (
  echo Extract the entire journal-check ZIP before starting it.
  pause
  exit /b 1
)
set "ELECTRON_RUN_AS_NODE=1"
"%ARRA_PF700_RUNTIME%" "%ARRA_PF700_JOURNAL%"
set "result=%errorlevel%"
echo.
pause
exit /b %result%
