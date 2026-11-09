# TSCOP / Fusion safeOS — Smart Patrol & Beat Management Demo (Node.js + Python)

A full-stack Smart Policing demo project built from the specifications, wireframes, flowcharts, and slide deck in `D:\AI_Usecases\Patroling\`.

---

## 1. Software Prerequisites & Recommended Versions

| Software | Status on Your PC | Recommended Version | Purpose | Download / Install Note |
| :--- | :--- | :--- | :--- | :--- |
| **Node.js (LTS)** | Not Installed | **v22.x LTS** (e.g., `22.14.0` LTS, includes `npm 10.x`; v20 LTS+ works) | Real-Time Express + Socket.IO Gateway, live GPS telemetry simulator & Command Center UI (Port `3000`) | https://nodejs.org/ — Use the Windows `.msi` installer |
| **Python (64-bit)** | Not Installed (only Windows Store alias found) | **Python 3.12.x** (e.g., `3.12.8` or `3.12.9`; `3.11–3.13` supported) | FastAPI Geospatial, 30m Geofence, Route Optimizer, SQLite DB & AI/NLP Engine (Port `8000`) | https://www.python.org/downloads/ — **IMPORTANT:** Check **"Add python.exe to PATH"** during install |
| **Web Browser** | Pre-installed | **Chrome 130+** or **Edge 130+** | Leaflet GIS maps, Web Audio emergency siren, Web Speech voice input | — |
| **Git** | Already Installed (`2.52.0`) | `2.52.0` | Version control | Already ready |
| **VS Code** | Already Installed | Latest | Code editing & terminal | Already ready |
| **PostgreSQL + PostGIS** | *Optional* | **PostgreSQL 17/18 + PostGIS 3.5** | Production spatial DB (reference DDL in `database/schema_postgres_postgis.sql`) | **Not needed for demo** — built-in SQLite runs automatically with zero DB setup |

> **Windows Python Tip:** Windows ships a fake `python.exe` stub in `WindowsApps` that opens Microsoft Store. After installing Python 3.12 from python.org, verify in a **new** PowerShell/CMD window that `py --version` and `node --version` both print real version numbers.

---

## 2. Architecture (Node.js + Python)

```
Browser (Command Center + Mobile Simulator)
   │   HTTP + Socket.IO (Port 3000)
   ▼
┌──────────────────────────────────────────────────────────┐
│ Node.js Service (node-gateway/server.js) — Port 3000     │
│ • Express Static Server & Unified API Gateway            │
│ • Socket.IO Real-Time GPS Patrol Simulator (2.5s ticks)  │
│ • Live Dial 100 Siren & Incident Alert Broadcaster       │
└──────────────────────────┬───────────────────────────────┘
                           │ REST HTTP (127.0.0.1:8000)
                           ▼
┌──────────────────────────────────────────────────────────┐
│ Python Service (python-backend/app/main.py) — Port 8000  │
│ • FastAPI REST Engine + Auto-Seeded SQLite Spatial DB    │
│ • Haversine 30m Geofence Check & Nearest Unit Dispatch   │
│ • Area-Oriented vs Crime-Oriented Beat Route Optimizer   │
│ • AI Blind Spot (>12h) Detector & Telugu/Hindi Translator│
└──────────────────────────────────────────────────────────┘
```

---

## 3. One-Time Setup (After Installing Node.js & Python)

### Option A: 1-Click Automated Setup
Double-click **`setup.bat`** inside `D:\AI_Usecases\Patroling\patrol-demo\`.

### Option B: Manual Setup in PowerShell / CMD
```powershell
# 1. Setup Python virtual environment & packages
cd D:\AI_Usecases\Patroling\patrol-demo\python-backend
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

# 2. Setup Node.js dependencies
cd D:\AI_Usecases\Patroling\patrol-demo\node-gateway
npm install
```

---

## 4. How to Launch & Start the Services

### Option A: 1-Click Windows Launcher
Double-click **`start-demo.bat`** inside `D:\AI_Usecases\Patroling\patrol-demo\`.
This opens two labeled console windows (Python Port `8000` + Node.js Port `3000`) and automatically opens **http://127.0.0.1:3000** in your browser.

### Option B: Manual Launch (Two Terminals)
**Terminal 1 — Python FastAPI AI & GIS Engine:**
```powershell
cd D:\AI_Usecases\Patroling\patrol-demo\python-backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```
*(Interactive Swagger API Docs available at `http://127.0.0.1:8000/docs`)*

**Terminal 2 — Node.js Express + Socket.IO Gateway & Web UI:**
```powershell
cd D:\AI_Usecases\Patroling\patrol-demo\node-gateway
node server.js
```

Open **`http://127.0.0.1:3000`** in Chrome or Edge. Both header pills (`Node:3000` and `Python:8000 OK`) should turn green.

---

## 5. Step-by-Step Live Demo Script ("How to Show the Demo")

1. **Command Dashboard (`📊`)**:
   - Point out live KPIs (`Total Patrol Vehicles`, `Active Incidents`, `P1 Critical`, `Blind Spots >12h`), Chart.js analytics, and vehicles moving live on the Hyderabad map via Node.js Socket.IO.
   - Click **`🌙 Dark (Fusion)`** in the top navbar to switch between **TSCOP Light Mode** (royal blue + pink) and **Fusion safeOS Dark GIS Mode**.
2. **Live GIS & Beat Planner (`🗺️`)**:
   - Toggle **Crime Hotspot Layer**, **Crime Corridors**, and **College Geofences**.
   - Pick `Abids PS` or `Gachibowli PS`, switch between **Area Oriented** and **Crime Oriented**, and click **`⚡ RECOMMENDED BEAT POINTS`** to compute route distance and display **Planned vs Actual Route** comparison.
3. **Today Route Plan & 3-Shift Maps (`📅`)**:
   - Show the **3 side-by-side Shift Geo-Graphical Maps** (`Shift 1: 06-14`, `Shift 2: 14-22`, `Shift 3: 22-06`).
   - Change any station's Plan (`PLAN A` → `PLAN C`) and click **`✔ SUBMIT TODAY ROUTE PLAN`** to prevent criminal predictability.
4. **PB Matrix & New Entry (`📘`)**:
   - Expand any Point Book row (`▶ Plans A-D`) to edit `SHIFT 1 / SHIFT 2 / SHIFT 3` timings across `PLAN A..D` and click **`SET TIMINGS`**.
   - Click **`+ Register New Point Book`** to add a new ATM/College/Ganesh Pandal.
5. **Dial 100 Route Diversion Flow (`🚨`)**:
   - Click **`1️⃣ Trigger Dial 100 Call & Divert Nearest Patrol Unit`**: hear the Web Audio siren, watch Python Haversine find the closest patrol car, and see the `PatrolManagement` flowchart highlight `Dial 100 Call` → `Route Diversion`.
   - Click **`2️⃣ Complete Call & Calculate Points Balance`** to inspect visited vs remaining beat points, then click **`3A. Continue Beat Route`** or **`3B. Close The Day`**.
6. **Field Constable Mobile App Simulator (`📱`)**:
   - Tap `PBA226471` (Andhra Bank ATM) inside the smartphone screen.
   - Drag the **GPS Distance slider** inside `<= 30m` (green verified) vs `> 30m` (outside perimeter warning).
   - Click **`Telugu: Suspicious College`** (or **`🎤 Speak`**) to capture native Telugu voice/text and click **`SUBMIT`** — watch Python AI translate Telugu into a formal English police log and update `Deviation in Time` (`00:02:30 HRS`).
7. **AI Insights & SHO Audit Reports (`🤖`)**:
   - Inspect **Blind Spots (>12h unvisited)**, test the **Native-to-English Translator Sandbox**, and click **`⬇ Export Official CSV Report`**.
