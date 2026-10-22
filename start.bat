@echo off
title XMLsync
echo Starting XMLsync...

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)

REM Check if built files exist
if not exist "dist\main.js" (
    echo Building project...
    call npx tsc
)

echo Launching app...
call npx electron ./dist/main.js
pause
