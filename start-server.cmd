@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=5500

echo.
echo   Seeker — локальный сервер для проверки входа через Google
echo   Адрес: http://localhost:%PORT%/dashboard.html
echo   Остановить: Ctrl+C
echo.

start "" "http://localhost:%PORT%/dashboard.html"

py -3 -m http.server %PORT% 2>nul || python -m http.server %PORT%
pause
