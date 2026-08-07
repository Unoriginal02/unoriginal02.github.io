@echo off
REM ============================================================
REM  DITHERPUNK - local dev server
REM  Double-click this file, or run:  serve.cmd [port]
REM ============================================================

cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel%==0 (
    node serve.js %*
    goto :end
)

echo   Node not found, falling back to Python...
set PORT=%1
if "%PORT%"=="" set PORT=8765

where python >nul 2>&1
if %errorlevel%==0 (
    echo.
    echo     http://localhost:%PORT%/
    echo     Ctrl+C to stop.
    echo.
    echo     NOTE: Python's server caches files. Hard-refresh
    echo           with Ctrl+F5 after editing.
    echo.
    start "" "http://localhost:%PORT%/"
    python -m http.server %PORT%
    goto :end
)

echo.
echo   Neither Node nor Python was found on PATH.
echo   Install either one, then run this again.
echo.
pause

:end
