@echo off
chcp 65001 >nul
title Pokorni z Pribora - Local Server ^& CMS
cd /d "%~dp0"

echo ============================================================
echo   Pokorni z Pribora - Spoustim lokalni server...
echo   Verejny web:      http://localhost:3000
echo   CMS Administrace: http://localhost:3000/admin.html
echo   Vychozi heslo:    pribor1756
echo ============================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [CHYBA] Node.js nebyl nalezen. Nainstalujte prosim Node.js z https://nodejs.org/
    pause
    exit /b 1
)

start "" "http://localhost:3000"
node server.js
pause
