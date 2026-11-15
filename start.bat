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
    echo [INFO] Node.js nebyl nalezen. Pokousim se automaticky nainstalovat Node.js LTS...
    where winget >nul 2>nul
    if %errorlevel% equ 0 (
        winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        set "PATH=%PATH%;%ProgramFiles%\nodejs;%APPDATA%\npm"
    ) else (
        echo [INFO] Stahuji instalator Node.js LTS pomoci PowerShellu...
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
          "$url = 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi'; " ^
          "$out = Join-Path $env:TEMP 'nodejs-lts.msi'; " ^
          "Invoke-WebRequest -Uri $url -OutFile $out; " ^
          "Start-Process msiexec.exe -Wait -ArgumentList '/i', $out, '/passive', '/norestart'"
        set "PATH=%PATH%;%ProgramFiles%\nodejs"
    )
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "PATH=%PATH%;%ProgramFiles%\nodejs"
    ) else (
        echo [CHYBA] Automaticka instalace Node.js se nezdarila nebo vyzaduje restart okna.
        echo Nainstalujte prosim Node.js z https://nodejs.org/ a spustte start.bat znovu.
        pause
        exit /b 1
    )
)

start "" "http://localhost:3000"
node server.js
pause
