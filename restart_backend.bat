@echo off
setlocal
set "ROOT=%~dp0"
timeout /t 3 /nobreak > NUL

where pm2 > NUL 2>&1
if %ERRORLEVEL% EQU 0 (
  pm2 restart all
  goto :done
)

taskkill /F /FI "WINDOWTITLE eq Warehouse-Backend" /T > NUL 2>&1

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000 " ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a > NUL 2>&1
)
timeout /t 2 /nobreak > NUL
cd /d "%ROOT%backend"
start "Warehouse-Backend" cmd /c "npm run dev"

:done
endlocal
