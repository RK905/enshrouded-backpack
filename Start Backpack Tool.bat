@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
where pythonw >nul 2>&1
if errorlevel 1 (
  python app.py
) else (
  start "" pythonw app.py
)
