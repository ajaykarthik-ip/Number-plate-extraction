@echo off
REM ==========================================================================
REM  One-click wrapper around:  npm run exe
REM
REM  Installs what is missing, exports the frontend, and builds
REM      desktop\release\AutoGateNX-Setup-1.0.0.exe
REM      desktop\release\AutoGateNX-Portable-1.0.0.exe
REM
REM  DOUBLE-CLICK THIS FILE from File Explorer. Do not run it from the VS Code
REM  terminal: its shell integration types into whatever console program is
REM  running, which can land on this batch file's prompts and kill the build
REM  half-way through.
REM
REM  First run needs internet (Electron is ~250 MB). Later runs are offline
REM  and take about a minute.
REM ==========================================================================
setlocal
cd /d "%~dp0"

echo ============================================================
echo   AutoGate NX - building the Windows app
echo   First run downloads Electron. Long silences are NORMAL.
echo   DO NOT close this window or press any key.
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not on PATH. Install it from https://nodejs.org
  goto :failed
)

REM A running copy would lock the files being replaced.
taskkill /F /IM AutoGateNX.exe /T >nul 2>&1

call npm run exe
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo   DONE
echo ============================================================
dir /b desktop\release\*.exe
echo.
echo Ship AutoGateNX-Setup-1.0.0.exe (installer) or
echo AutoGateNX-Portable-1.0.0.exe (runs with no install).
echo.
pause
exit /b 0

:failed
echo.
echo *** BUILD FAILED - read the error above. Nothing was shipped. ***
echo.
pause
exit /b 1
