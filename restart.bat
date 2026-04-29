@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "FRONTEND_DIR=%ROOT%frontend"

echo Restarting Warehouse POS Services...

rem Stop previous backend/frontend windows (use wildcard to catch title suffixes).
taskkill /F /FI "WINDOWTITLE eq Warehouse-Backend*" /T > nul 2>&1
taskkill /F /FI "WINDOWTITLE eq Warehouse-Frontend*" /T > nul 2>&1

rem Force-kill any process still listening on service ports.
call :KILL_PORT 5000
call :KILL_PORT 3000

timeout /t 2 /nobreak > nul

rem Start DB services if installed.
net start MySQL80 > nul 2>&1
if errorlevel 1 echo [INFO] MySQL80 start skipped or failed.
net start mariadb > nul 2>&1
if errorlevel 1 echo [INFO] mariadb start skipped or failed.
net start mariadb11 > nul 2>&1
if errorlevel 1 echo [INFO] mariadb11 start skipped or failed.

if not exist "%BACKEND_DIR%\package.json" (
  echo [ERROR] Backend directory not found: "%BACKEND_DIR%"
  goto :END
)
if not exist "%FRONTEND_DIR%\package.json" (
  echo [ERROR] Frontend directory not found: "%FRONTEND_DIR%"
  goto :END
)

echo Starting backend...
start "Warehouse-Backend" /d "%BACKEND_DIR%" cmd /k "title Warehouse-Backend && npm run dev"

echo Starting frontend...
start "Warehouse-Frontend" /d "%FRONTEND_DIR%" cmd /k "title Warehouse-Frontend && set BROWSER=none && npm start"

echo Restart command completed. Check opened backend/frontend windows for runtime logs.
goto :END

:KILL_PORT
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%~1 .*LISTENING"') do (
  taskkill /F /PID %%a > nul 2>&1
)
exit /b 0

:END
endlocal
