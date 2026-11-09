@echo off
setlocal enabledelayedexpansion
title TSCOP / SafeOS Patrol Demo - Setup Installer
echo ============================================================================
echo   TSCOP / Fusion safeOS - Smart Patrol Demo Setup (Node.js + Python)
echo ============================================================================
echo.

REM 1. Check Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is NOT installed or not in PATH.
    echo         Please install Node.js v22 LTS from https://nodejs.org/
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Found Node.js %NODE_VER%

REM 2. Check Python (prefer py -3 launcher or real python.exe, skip Store stub)
set PY_CMD=
where py >nul 2>nul
if not errorlevel 1 (
    py -3 --version >nul 2>nul
    if not errorlevel 1 set PY_CMD=py -3
)
if "%PY_CMD%"=="" (
    python --version >nul 2>nul
    if not errorlevel 1 set PY_CMD=python
)
if "%PY_CMD%"=="" (
    echo [ERROR] Python 3.11+ is NOT installed or Windows Store alias is blocking it.
    echo         Please install Python 3.12 (64-bit) from https://www.python.org/downloads/
    echo         IMPORTANT: Check "Add python.exe to PATH" during installation!
    pause
    exit /b 1
)
for /f "delims=" %%v in ('%PY_CMD% --version') do set PY_VER=%%v
echo [OK] Found %PY_VER% (%PY_CMD%)

echo.
echo [Step 1/2] Setting up Python Virtual Environment & installing FastAPI/Uvicorn...
cd /d "%~dp0python-backend"
if not exist ".venv\Scripts\python.exe" (
    %PY_CMD% -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create Python virtual environment.
        pause
        exit /b 1
    )
)
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install Python packages.
    pause
    exit /b 1
)

echo.
echo [Step 2/2] Installing Node.js dependencies (Express + Socket.IO)...
cd /d "%~dp0node-gateway"
call npm install
if errorlevel 1 (
    echo [ERROR] Failed to install Node.js packages.
    pause
    exit /b 1
)

echo.
echo ============================================================================
echo   SETUP COMPLETE!
echo   To launch both services and open the demo, double-click: start-demo.bat
echo ============================================================================
pause
