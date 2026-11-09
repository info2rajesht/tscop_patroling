@echo off
title TSCOP / SafeOS Patrol Demo Launcher
echo ============================================================================
echo   Starting TSCOP / Fusion safeOS Patrol Management Demo
echo   1. Python FastAPI AI & GIS Engine  -> http://127.0.0.1:8000
echo   2. Node.js Express + Socket.IO UI  -> http://127.0.0.1:3000
echo ============================================================================
echo.

set "ROOT_DIR=%~dp0"
set "PY_EXE=%ROOT_DIR%python-backend\.venv\Scripts\python.exe"
if not exist "%PY_EXE%" (
    echo [WARN] .venv not found. Checking global python...
    set "PY_EXE=python"
)

if not exist "%ROOT_DIR%node-gateway\node_modules" (
    echo [ERROR] node_modules missing! Please run setup.bat first.
    pause
    exit /b 1
)

echo Launching Python FastAPI AI/GIS Backend (Port 8000)...
start "TSCOP Python AI & GIS (Port 8000)" cmd /k "cd /d "%ROOT_DIR%python-backend" && "%PY_EXE%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000"

timeout /t 3 /nobreak >nul

echo Launching Node.js Command Gateway & Web UI (Port 3000)...
start "TSCOP Node.js Gateway & UI (Port 3000)" cmd /k "cd /d "%ROOT_DIR%node-gateway" && node server.js"

timeout /t 2 /nobreak >nul

echo Opening Demo Dashboard in your default browser...
start "" "http://127.0.0.1:3000"

echo.
echo Both services are running in separate windows.
echo Close those two terminal windows when you want to stop the demo.
echo.
