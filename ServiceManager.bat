@echo off
setlocal enabledelayedexpansion
title Warehouse POS Service Manager

:: Project directories
set "PROJECT_ROOT=%~dp0"
set "BACKEND_DIR=%PROJECT_ROOT%backend"
set "FRONTEND_DIR=%PROJECT_ROOT%frontend"

:MENU
cls
echo ==========================================
echo    Warehouse POS Service Manager
echo ==========================================
echo  1. Start All Services (MySQL, BE, FE)
echo  2. Stop All Services
echo  3. Restart All Services
echo  4. Open Web Page (localhost:3000)
echo  5. Check Service Status
echo  6. Exit
echo ==========================================
set /p choice="Select an option (1-6): "

if "%choice%"=="1" goto START_ALL
if "%choice%"=="2" goto STOP_ALL
if "%choice%"=="3" goto RESTART_ALL
if "%choice%"=="4" goto OPEN_WEB
if "%choice%"=="5" goto STATUS
if "%choice%"=="6" exit
goto MENU

:START_ALL
echo Starting MySQL Service...
net start MySQL80 2>nul
if %errorlevel% neq 0 (
    echo [INFO] MySQL80 service is already running or could not be started automatically.
)

echo Starting Backend Server...
cd /d "%BACKEND_DIR%"
start "Warehouse-Backend" cmd /c "npm run dev"

echo Starting Frontend Server...
cd /d "%FRONTEND_DIR%"
set BROWSER=none
start "Warehouse-Frontend" cmd /c "npm start"

echo.
echo Waiting for services to initialize (10 seconds)...
timeout /t 10 /nobreak

echo Opening Web Page...
start http://localhost:3000
pause
goto MENU

:STOP_ALL
echo Stopping Node.js processes...
:: Kill only specific processes to avoid closing Gemini CLI (Node.exe)
taskkill /F /FI "WINDOWTITLE eq Warehouse-Backend" /T 2>nul
taskkill /F /FI "WINDOWTITLE eq Warehouse-Frontend" /T 2>nul
echo All services stopped.
pause
goto MENU

:RESTART_ALL
echo Restarting Services...
:: Kill only specific processes to avoid closing Gemini CLI (Node.exe)
taskkill /F /FI "WINDOWTITLE eq Warehouse-Backend" /T 2>nul
taskkill /F /FI "WINDOWTITLE eq Warehouse-Frontend" /T 2>nul
timeout /t 2 /nobreak

:: Don't call START_ALL because we don't want a new browser window.
echo Starting MySQL Service...
net start MySQL80 2>nul
echo Starting Backend Server...
cd /d "%BACKEND_DIR%"
start "Warehouse-Backend" cmd /c "npm run dev"
echo Starting Frontend Server...
cd /d "%FRONTEND_DIR%"
set BROWSER=none
start "Warehouse-Frontend" cmd /c "npm start"
echo.
echo Services restarted. Please refresh your browser.
pause
goto MENU

:OPEN_WEB
start http://localhost:3000
goto MENU

:STATUS
echo.
echo --- Service Status ---
tasklist /FI "WINDOWTITLE eq Warehouse-Backend*" | findstr /i "cmd.exe" >nul && (echo [OK] Backend is running) || (echo [OFF] Backend is NOT running)
tasklist /FI "WINDOWTITLE eq Warehouse-Frontend*" | findstr /i "cmd.exe" >nul && (echo [OK] Frontend is running) || (echo [OFF] Frontend is NOT running)
net start | findstr /i "MySQL80" >nul && (echo [OK] MySQL is running) || (echo [OFF] MySQL is NOT running)
echo.
pause
goto MENU
