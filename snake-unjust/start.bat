@echo off
setlocal

set "PORT=8081"
set "URL=http://localhost:%PORT%/"

cd /d "%~dp0"

where py >nul 2>&1
if %errorlevel%==0 (
  start "Snake Unjust Server" cmd /k py -m http.server %PORT%
) else (
  where python >nul 2>&1
  if %errorlevel%==0 (
    start "Snake Unjust Server" cmd /k python -m http.server %PORT%
  ) else (
    echo Python was not found in PATH.
    echo Install Python or add it to PATH, then run this again.
    pause
    exit /b 1
  )
)

timeout /t 1 /nobreak >nul
start "" "%URL%"

echo Server started on %URL%
echo Close the "Snake Unjust Server" window to stop it.

endlocal
