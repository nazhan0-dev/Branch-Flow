@echo off
REM Double-click to clear all data in the database (keeps only admin@bl.test and exec@bl.test, password Demo@1234)
cd /d "%~dp0server"
echo.
echo === BranchFlow: clearing database (npm run db:empty) ===
echo.
call npm run db:empty
echo.
echo Done. If the server is running, refresh the browser and log in again.
pause
