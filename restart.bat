@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"

echo Restarting Warehouse POS Services...
call "%ROOT%stop.bat"
call "%ROOT%start.bat"

endlocal
