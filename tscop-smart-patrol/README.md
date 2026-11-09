# TSCOP / Fusion safeOS — Smart Patrol Management System

A production-grade Smart Patrol & Beat Management System built using **React 18** and **Node.js** with **AI-driven Historical Incident Intelligence** and **SHO (Station House Officer) Override Rights**.

---

## 1. Key Features

1. **AI Beat Point & Timing Suggestions (Based on Last Month's Data)**:
   - Evaluates 30 days of historical incident density, crime categories (Eve-teasing, Burglary, Card Skimming, Wine Shop closures, Mandap crowd surges), and temporal crime peaks.
   - Generates recommended visit timings for **Shift 1 (Morning)**, **Shift 2 (Afternoon/Evening)**, and **Shift 3 (Night)**.
   - Calculates a normalized **Crime Risk Score (1-100)** to prioritize vulnerable beat points.

2. **SHO Override & Customization Engine**:
   - The Station House Officer (SHO) has full authority to inspect, accept, or overwrite any AI suggested visit timing or beat sequence.
   - Saves operational rationale with an official audit trail (`OVR-XXXX`) and broadcasts updates in real-time to active field units.

3. **3-Shift Beat Visualizer & Today Route Plans**:
   - Manages mandatory 24x7 coverage across 3 shifts:
     - `Shift 1 (Shift A)`: 06:00 AM - 02:00 PM (School openings, bank cash replenishment)
     - `Shift 2 (Shift B)`: 02:00 PM - 10:00 PM (College dismissals, festival mandaps, wine shops)
     - `Shift 3 (Shift C)`: 10:00 PM - 06:00 AM (Night commercial closure, anti-burglary beats)
   - Supports daily non-predictable rotation across `Plan A`, `Plan B`, `Plan C`, and `Plan D`.

4. **Dial 100 Emergency Route Diversion State Machine**:
   - Implements the exact flowchart from `PatrolManagement_dark.png`:
     `Route Decide` → `Dial 100 Call` → `Nearest Unit Route Diversion` → `Complete Call` → `Show Points Balance` → `Continue Route` / `Close the Day`.

5. **Field Constable Mobile App Simulator**:
   - Interactive smartphone bezel with **30-meter Geofence verification slider** (test inside vs outside 30m).
   - Real-time **Deviation in Time** counter (`00:02:30 HRS`).
   - Native Telugu / Hindi speech-to-text logging with automatic formal English police log translation.

6. **Live Telemetry & GIS Mapping**:
   - Continuous GPS telemetry loop (2.5-second ticks) simulating patrol vehicle circuits across Hyderabad.
   - Interactive Leaflet maps with custom police car markers, incident pins, and geofence perimeters.

---

## 2. Architecture & Design

```
Frontend (React 18 + Tailwind CSS + Leaflet + Chart.js)
   │
   │  REST APIs + Server-Sent Events (SSE) Live Feed
   ▼
Node.js Core Server (server/server.js) — Port 3000
   ├── services/historicalAnalytics.js  (Last Month Data AI Recommender)
   ├── services/geoService.js           (Haversine & 30m Geofencing)
   ├── services/patrolSimulator.js      (Real-Time GPS Telemetry Engine)
   ├── services/nlpTranslator.js        (Telugu/Hindi Native Police NLP)
   └── data/
       ├── db.json                      (Point Books, Vehicles, Shifts, Incidents)
       └── lastMonthData.json           (30-Day Historical Crime Records)
```

- **Zero External Dependencies**: Built using Node's standard native modules (`http`, `fs`, `path`, `url`), eliminating package installation failures.
- **Runtimes Detected**: Utilizes the installed **Node.js v26.13.0** (`C:\Program Files\nodejs\node.exe`).

---

## 3. How to Launch & Run the Server

Double-click **`start.bat`** inside `d:\AI_Usecases\Patroling\tscop-smart-patrol\`, or run in PowerShell:

```powershell
cd d:\AI_Usecases\Patroling\tscop-smart-patrol
& "C:\Program Files\nodejs\node.exe" server/server.js
```

Open your browser to:
**`http://localhost:3000`**

---

## 4. How to Demonstrate the System (Demo Script)

1. **AI Recommendations & SHO Changes**:
   - Navigate to **`🧠 Last Month AI Beat & Timing Recommender`**.
   - Review the risk scores and suggested timings derived from the 30-day historical data.
   - In the **SHO Overwrite Console**, select `PB-COL-01 (Nampally Junior College)`, modify `Shift 1 Timing` to `08:25 AM`, and click **`✔ APPLY SHO OVERRIDE`**.
   - Observe the live audit trail update and field sync confirmation.

2. **Dial 100 Route Diversion**:
   - Click **`🚨 Dial 100 Emergency`** in the top header.
   - Watch the Web Audio police siren activate, nearest patrol unit divert, and the flowchart transition to `Route Diversion`.
   - Click **`2️⃣ Complete Call`** to inspect the **Points Balance** (visited vs remaining), then click **`3A. Continue Beat`**.

3. **Field Constable Mobile Simulator**:
   - Switch to **`📱 Field Constable Mobile Simulator`**.
   - Tap `PBA226471 (Andhra Bank ATM)` to open the `POINTBOOK VISITING` modal.
   - Move the **GPS Distance slider** (e.g., to 15m for `✔ Within 30m` or 55m for `⚠ Outside 30m`).
   - Click **`Sample Telugu Voice`** to populate native Telugu remarks, then click **`SUBMIT`** to view the translated English police log and recorded time deviation.
