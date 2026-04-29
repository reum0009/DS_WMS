@echo off
set "PROJECT_ROOT=%~dp0"
echo Starting Warehouse POS Services...
net start MySQL80 2>nul
cd /d "%PROJECT_ROOT%backend"
start "Warehouse-Backend" cmd /c "npm run dev"
cd /d "%PROJECT_ROOT%frontend"
set BROWSER=none
start "Warehouse-Frontend" cmd /c "npm start"
timeout /t 5
start http://localhost:3000
echo Started.
timeout /t 3
