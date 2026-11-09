# PowerShell Single-Terminal Launcher for TSCOP / SafeOS Patrol Demo
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PyDir = Join-Path $Root "python-backend"
$NodeDir = Join-Path $Root "node-gateway"
$PyExe = Join-Path $PyDir ".venv\Scripts\python.exe"

if (-not (Test-Path $PyExe)) {
    throw "Python .venv not found. Please run setup.bat first."
}
if (-not (Test-Path (Join-Path $NodeDir "node_modules"))) {
    throw "node_modules not found. Please run setup.bat first."
}

Write-Host "Starting Python AI & GIS Engine on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
$pyProc = Start-Process -FilePath $PyExe -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000" -WorkingDirectory $PyDir -PassThru

Start-Sleep -Seconds 2
Write-Host "Starting Node.js Gateway & UI on http://127.0.0.1:3000 ..." -ForegroundColor Green
$nodeProc = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $NodeDir -PassThru

Start-Sleep -Seconds 2
Start-Process "http://127.0.0.1:3000"

Write-Host "`nDemo running! Press ENTER to stop both services..." -ForegroundColor Yellow
Read-Host | Out-Null

Stop-Process -Id $nodeProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $pyProc.Id -Force -ErrorAction SilentlyContinue
Write-Host "Services stopped."
