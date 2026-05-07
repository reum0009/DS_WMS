@echo off
setlocal EnableExtensions

set "PROJECT_ROOT=%~dp0"
set "BACKEND_DIR=%PROJECT_ROOT%backend"
set "FRONTEND_DIR=%PROJECT_ROOT%frontend"

echo Starting Warehouse POS Services...

rem Start a local database service when it exists. This PC uses MariaDB,
rem while some installs use MySQL80.
call :START_SERVICE MySQL80
call :START_SERVICE MariaDB
call :START_SERVICE mariadb
call :START_SERVICE mariadb11

if not exist "%BACKEND_DIR%\package.json" (
  echo [ERROR] Backend directory not found: "%BACKEND_DIR%"
  goto :END
)

if not exist "%FRONTEND_DIR%\package.json" (
  echo [ERROR] Frontend directory not found: "%FRONTEND_DIR%"
  goto :END
)

where npm.cmd > nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found. Install Node.js or add npm to PATH.
  goto :END
)

call :IS_PORT_LISTENING 5000
if errorlevel 1 (
  echo Starting backend on http://localhost:5000 ...
  call :START_BACKEND
) else (
  echo Backend already appears to be running on port 5000.
)

call :IS_PORT_LISTENING 3000
if errorlevel 1 (
  echo Starting frontend on http://localhost:3000 ...
  call :START_FRONTEND
) else (
  echo Frontend already appears to be running on port 3000.
)

echo Waiting for services to become ready...
call :WAIT_FOR_PORT 5000 30
if errorlevel 1 (
  echo [ERROR] Backend did not start on port 5000. Check service-backend.err.log.
  goto :END
)

call :WAIT_FOR_PORT 3000 60
if errorlevel 1 (
  echo [ERROR] Frontend did not start on port 3000. Check service-frontend.err.log.
  goto :END
)

start http://localhost:3000
echo Started in the background. Use stop.bat when you want to stop the service.
goto :END

:START_SERVICE
sc query "%~1" > nul 2>&1
if errorlevel 1 exit /b 0
net start "%~1" > nul 2>&1
exit /b 0

:START_BACKEND
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'npm.cmd' -WorkingDirectory '%BACKEND_DIR%' -ArgumentList @('run','dev') -RedirectStandardOutput '%PROJECT_ROOT%service-backend.log' -RedirectStandardError '%PROJECT_ROOT%service-backend.err.log' -WindowStyle Hidden"
exit /b %errorlevel%

:START_FRONTEND
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:BROWSER = 'none'; Start-Process -FilePath 'npm.cmd' -WorkingDirectory '%FRONTEND_DIR%' -ArgumentList @('start') -RedirectStandardOutput '%PROJECT_ROOT%service-frontend.log' -RedirectStandardError '%PROJECT_ROOT%service-frontend.err.log' -WindowStyle Hidden"
exit /b %errorlevel%

:IS_PORT_LISTENING
netstat -ano | findstr /R /C:":%~1 .*LISTENING" > nul
if errorlevel 1 exit /b 1
exit /b 0

:WAIT_FOR_PORT
set "WAIT_PORT=%~1"
set "WAIT_SECONDS=%~2"
set /a WAIT_COUNT=0
:WAIT_FOR_PORT_LOOP
call :IS_PORT_LISTENING %WAIT_PORT%
if not errorlevel 1 exit /b 0
if %WAIT_COUNT% GEQ %WAIT_SECONDS% exit /b 1
call :SLEEP 1
set /a WAIT_COUNT+=1
goto :WAIT_FOR_PORT_LOOP

:SLEEP
set /a SLEEP_PINGS=%~1+1
ping -n %SLEEP_PINGS% 127.0.0.1 > nul
exit /b 0

:END
call :SLEEP 3
endlocal
