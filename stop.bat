@echo off
echo Stopping Warehouse POS Services...

:: Kill only specific processes to avoid closing Gemini CLI (Node.exe)
taskkill /F /FI "WINDOWTITLE eq Warehouse-Backend" /T 2>nul
taskkill /F /FI "WINDOWTITLE eq Warehouse-Frontend" /T 2>nul

echo All services stopped.
timeout /t 3
