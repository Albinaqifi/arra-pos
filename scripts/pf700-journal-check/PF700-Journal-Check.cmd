@echo off
setlocal
set "ARRA_PF700_RUNTIME=%LOCALAPPDATA%\Arra POS Offline Test\1.0.3\electron.exe"
if exist "%~dp0runtime\node.exe" set "ARRA_PF700_RUNTIME=%~dp0runtime\node.exe"
set "ARRA_PF700_JOURNAL=%~dp0scripts\pf700-journal-check\journal-check.js"
if not exist "%ARRA_PF700_RUNTIME%" (
  echo Extract the complete USB kit, or use the installed Arra 1.0.3 offline test runtime.
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
