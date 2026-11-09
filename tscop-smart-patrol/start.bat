@echo off
title TSCOP Smart Patrol & Beat Management Server
echo ============================================================================
echo   TSCOP / Fusion safeOS - Smart Patrol Management System
echo   Web Command Center & Mobile Simulator: http://localhost:3000
echo ============================================================================
echo.

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" (
    where node >nul 2>nul
    if not errorlevel 1 (
        set "NODE_EXE=node"
    ) else (
        echo [ERROR] Node.js executable not found!
        pause
        exit /b 1
    )
)

echo Starting TSCOP Server using %NODE_EXE%...
cd /d "%~dp0"
"%NODE_EXE%" server/server.js
pause
