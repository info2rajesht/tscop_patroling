/**
 * TSCOP / SafeOS Smart Patrol & Beat Management System
 * Node.js Express + Socket.IO Gateway (Port 3000)
 *
 * Responsibilities:
 * - Serves the unified Web Command Center & Mobile Constable Simulator UI
 * - Streams real-time patrol vehicle GPS telemetry via Socket.IO
 * - Proxies geospatial, SQLite & AI analytics calls to Python FastAPI (Port 8000)
 * - Broadcasts live Dial 100 emergency diversions & Point Book check-ins
 */

const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const PYTHON_API = process.env.PYTHON_API_URL || "http://127.0.0.1:8000";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Real-Time GPS Patrol Simulation Loops (Hyderabad Coordinates)
// ---------------------------------------------------------------------------
let simulatorRunning = true;
let simTick = 0;

// Smooth beat patrol waypoint loops keyed by vehicle_no
const PATROL_LOOPS = {
  TS09PA1001: [
    [17.3924, 78.4755],
    [17.3906, 78.4774],
    [17.3889, 78.4761],
    [17.3915, 78.4730],
    [17.3955, 78.4718],
  ],
  BC3: [
    [17.3974, 78.4710],
    [17.3976, 78.4712],
    [17.3935, 78.4695],
    [17.3895, 78.4720],
    [17.3948, 78.4742],
  ],
  TS09PA1002: [
    [17.4410, 78.3502],
    [17.4445, 78.3618],
    [17.4380, 78.3490],
    [17.4325, 78.3412],
    [17.4480, 78.3385],
  ],
  TS09PA1003: [
    [17.4375, 78.3840],
    [17.4356, 78.3864],
    [17.4402, 78.3820],
    [17.4435, 78.3772],
  ],
  "BC7-GCH": [
    [17.4495, 78.3790],
    [17.4504, 78.3812],
    [17.4472, 78.3755],
    [17.4455, 78.3825],
  ],
  PV003: [
    [17.4240, 78.4530],
    [17.4265, 78.4512],
    [17.4198, 78.4565],
    [17.4126, 78.4602],
  ],
};

function interpolateCoord(loop, step) {
  if (!loop || loop.length === 0) return null;
  const segments = loop.length;
  const subSteps = 6;
  const totalPos = (step % (segments * subSteps)) / subSteps;
  const idx = Math.floor(totalPos);
  const frac = totalPos - idx;
  const p1 = loop[idx % segments];
  const p2 = loop[(idx + 1) % segments];
  const lat = p1[0] + (p2[0] - p1[0]) * frac;
  const lon = p1[1] + (p2[1] - p1[1]) * frac;
  const heading = Math.round((Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180) / Math.PI + 360) % 360;
  return {
    latitude: Number(lat.toFixed(6)),
    longitude: Number(lon.toFixed(6)),
    heading,
  };
}

async function runTelemetryTick() {
  if (!simulatorRunning) return;
  simTick += 1;
  try {
    const resp = await fetch(`${PYTHON_API}/api/vehicles`, { signal: AbortSignal.timeout(2500) });
    if (!resp.ok) return;
    const data = await resp.json();
    const vehicles = data.vehicles || [];
    const updatedVehicles = [];

    for (const v of vehicles) {
      if (v.status === "Available") {
        updatedVehicles.push(v);
        continue;
      }
      const loop = PATROL_LOOPS[v.vehicle_no];
      if (!loop) {
        updatedVehicles.push(v);
        continue;
      }
      const pos = interpolateCoord(loop, simTick + v.id * 3);
      if (!pos) continue;
      const speed = v.status === "Diverted" || v.status === "Responding" ? 44 : 26;

      await fetch(`${PYTHON_API}/api/vehicles/${v.id}/telemetry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: pos.latitude,
          longitude: pos.longitude,
          speed_kmh: speed,
          heading: pos.heading,
        }),
        signal: AbortSignal.timeout(2000),
      });

      updatedVehicles.push({
        ...v,
        latitude: pos.latitude,
        longitude: pos.longitude,
        speed_kmh: speed,
        heading: pos.heading,
      });
    }

    io.emit("telemetry:update", {
      tick: simTick,
      timestamp: new Date().toISOString(),
      vehicles: updatedVehicles,
    });
  } catch (_err) {
    // Python backend may still be starting up; skip silently and retry next tick
  }
}

setInterval(runTelemetryTick, 2500);

// ---------------------------------------------------------------------------
// Gateway Health & Simulator Controls
// ---------------------------------------------------------------------------
app.get("/api/gateway/health", async (_req, res) => {
  let pythonStatus = "unreachable";
  let pythonDetails = null;
  try {
    const resp = await fetch(`${PYTHON_API}/health`, { signal: AbortSignal.timeout(2000) });
    if (resp.ok) {
      pythonStatus = "ok";
      pythonDetails = await resp.json();
    }
  } catch (_e) {
    pythonStatus = "unreachable";
  }

  res.json({
    node: "ok",
    port: PORT,
    python: pythonStatus,
    pythonUrl: PYTHON_API,
    simulatorRunning,
    connectedClients: io.engine.clientsCount,
    pythonDetails,
  });
});

app.get("/api/simulator/status", (_req, res) => {
  res.json({ simulatorRunning, tick: simTick });
});

app.post("/api/simulator/toggle", (req, res) => {
  if (typeof req.body?.running === "boolean") {
    simulatorRunning = req.body.running;
  } else {
    simulatorRunning = !simulatorRunning;
  }
  io.emit("simulator:status", { simulatorRunning });
  res.json({ simulatorRunning });
});

// ---------------------------------------------------------------------------
// Unified Proxy to Python FastAPI + Live Socket.IO Broadcasts
// ---------------------------------------------------------------------------
app.all("/api/*", async (req, res) => {
  const targetUrl = `${PYTHON_API}${req.originalUrl}`;
  try {
    const fetchOpts = {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
    };
    if (!["GET", "HEAD"].includes(req.method) && req.body !== undefined) {
      fetchOpts.body = JSON.stringify(req.body);
    }

    const upstream = await fetch(targetUrl, fetchOpts);
    const contentType = upstream.headers.get("content-type") || "application/json";
    const disposition = upstream.headers.get("content-disposition");
    if (disposition) {
      res.setHeader("Content-Disposition", disposition);
    }
    res.setHeader("Content-Type", contentType);

    if (contentType.includes("application/json")) {
      const data = await upstream.json();
      res.status(upstream.status).json(data);

      // Broadcast real-time events on mutating requests
      if (upstream.ok && req.method !== "GET") {
        if (req.originalUrl.startsWith("/api/dispatch/trigger")) {
          io.emit("dispatch:alert", data);
        } else if (req.originalUrl.startsWith("/api/dispatch")) {
          io.emit("dispatch:update", data);
        } else if (req.originalUrl.startsWith("/api/visits")) {
          io.emit("visit:logged", data);
        } else if (req.originalUrl.startsWith("/api/incidents")) {
          io.emit("incident:alert", data);
        }
        io.emit("data:refresh", { path: req.originalUrl, method: req.method });
      }
    } else {
      const text = await upstream.text();
      res.status(upstream.status).send(text);
    }
  } catch (err) {
    res.status(502).json({
      error: "Python AI/GIS service unavailable",
      detail: err.message,
      hint: "Ensure python-backend (port 8000) is running.",
    });
  }
});

// Fallback SPA route
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

io.on("connection", (socket) => {
  socket.emit("simulator:status", { simulatorRunning });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`==========================================================`);
  console.log(` TSCOP / SafeOS Node.js Command Gateway running!`);
  console.log(` Web UI & Mobile Simulator : http://127.0.0.1:${PORT}`);
  console.log(` Python AI/GIS Target      : ${PYTHON_API}`);
  console.log(`==========================================================`);
});
