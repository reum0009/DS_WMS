@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
echo Stopping Warehouse POS Services...

:: Kill only specific processes to avoid closing Gemini CLI (Node.exe)
taskkill /F /FI "WINDOWTITLE eq Warehouse-Backend*" /T > nul 2>&1
taskkill /F /FI "WINDOWTITLE eq Warehouse-Frontend*" /T > nul 2>&1

:: Stop hidden npm/nodemon/react-scripts processes launched from this project.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = '%ROOT%'; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and ($_.CommandLine -like '*npm.cmd run dev*' -or $_.CommandLine -like '*npm.cmd start*' -or $_.CommandLine -like '*nodemon*' -or $_.CommandLine -like '*react-scripts*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

:: Hidden/background mode has no visible window title, so stop by service ports.
call :KILL_PORT 5000
call :KILL_PORT 3000

echo All services stopped.
call :SLEEP 3
endlocal
exit /b 0

:KILL_PORT
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%~1 .*LISTENING"') do (
  taskkill /F /PID %%a /T > nul 2>&1
)
exit /b 0

:SLEEP
set /a SLEEP_PINGS=%~1+1
ping -n %SLEEP_PINGS% 127.0.0.1 > nul
exit /b 0
