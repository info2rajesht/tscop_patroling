/**
 * Core Application Controller:
 * - API client & dual-service health polling (Node Gateway + Python AI/GIS)
 * - Socket.IO real-time telemetry & emergency alert handling
 * - Web Audio API police siren synthesizer
 * - Theme switcher (TSCOP Light vs Fusion safeOS Dark) & Role switcher
 * - Command Dashboard KPIs & Chart.js analytics
 */

const App = {
  state: {
    activeView: "dashboard",
    theme: "light",
    role: "SHO",
    sirenEnabled: true,
    simulatorRunning: true,
    vehicles: [],
    pointBooks: [],
    incidents: [],
    aiInsights: null,
    dashboard: null,
    dailyRoutes: null,
    dispatchState: null,
    visits: [],
    charts: { incidents: null, shifts: null },
  },
  socket: null,

  async api(path, options = {}) {
    const opts = {
      headers: { "Content-Type": "application/json" },
      ...options,
    };
    const res = await fetch(path, opts);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        msg = err.detail || err.error || msg;
      } catch (_e) {}
      throw new Error(msg);
    }
    return res.json();
  },

  toast(message, type = "info") {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, 4500);
  },

  playSiren() {
    if (!this.state.sirenEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.linearRampToValueAtTime(980, now + 0.45);
      osc.frequency.linearRampToValueAtTime(520, now + 0.9);
      osc.frequency.linearRampToValueAtTime(980, now + 1.35);
      osc.frequency.linearRampToValueAtTime(520, now + 1.8);
      osc.start(now);
      osc.stop(now + 1.85);
    } catch (_e) {
      // Browser autoplay policy may block before user gesture; safe to ignore
    }
  },

  toggleSiren() {
    this.state.sirenEnabled = !this.state.sirenEnabled;
    document.getElementById("btn-siren").textContent = this.state.sirenEnabled
      ? "🔊 Siren: ON"
      : "🔇 Siren: OFF";
  },

  toggleTheme() {
    this.state.theme = this.state.theme === "light" ? "dark" : "light";
    document.body.className = this.state.theme === "dark" ? "theme-dark" : "theme-light";
    document.getElementById("btn-theme").textContent =
      this.state.theme === "dark" ? "☀️ Light (TSCOP)" : "🌙 Dark (Fusion)";
    if (window.Maps) Maps.updateAllBasemaps();
    if (this.state.dashboard) this.renderCharts();
  },

  changeRole(role) {
    this.state.role = role;
    const labels = {
      SHO: "Active: SHO_ABIDS (Full Override)",
      ADMIN: "Active: Control Room / District Admin",
      PC: "Active: Field Constable (BC3)",
    };
    document.getElementById("sidebar-role-banner").textContent = labels[role] || role;
    const dailyBtn = document.getElementById("btn-submit-daily");
    if (dailyBtn) {
      dailyBtn.disabled = role === "PC";
      dailyBtn.title = role === "PC" ? "Only SHO / Control Room can confirm daily routes" : "";
    }
    this.toast(`Switched active persona to <b>${role}</b>`, "info");
    if (role === "PC") {
      this.switchView("mobile-app");
    }
  },

  async toggleSimulator() {
    try {
      const res = await this.api("/api/simulator/toggle", {
        method: "POST",
        body: JSON.stringify({}),
      });
      this.state.simulatorRunning = res.simulatorRunning;
      document.getElementById("btn-sim-toggle").textContent = res.simulatorRunning
        ? "⏸ GPS Sim: ON"
        : "▶ GPS Sim: PAUSED";
    } catch (e) {
      this.toast(`Simulator toggle failed: ${e.message}`, "emergency");
    }
  },

  async resetDemo() {
    try {
      await this.api("/api/reset-demo", { method: "POST", body: JSON.stringify({}) });
      this.toast("Demo database restored to fresh Hyderabad initial state.", "success");
      await this.loadAllData();
    } catch (e) {
      this.toast(`Reset failed: ${e.message}`, "emergency");
    }
  },

  switchView(viewId) {
    this.state.activeView = viewId;
    document.querySelectorAll(".view-panel").forEach((p) => p.classList.remove("active"));
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.add("active");

    document.querySelectorAll(".nav-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === viewId);
    });

    // Resize Leaflet maps when their containers become visible
    setTimeout(() => {
      if (window.Maps) Maps.invalidateAll();
      if (window.MobileSim && viewId === "mobile-app") MobileSim.invalidateMap();
    }, 120);
  },

  async checkHealth() {
    try {
      const h = await this.api("/api/gateway/health");
      const pyDot = document.getElementById("dot-python");
      const pyLbl = document.getElementById("lbl-python-status");
      if (h.python === "ok") {
        pyDot.className = "dot dot-green";
        pyLbl.textContent = "Python:8000 OK";
      } else {
        pyDot.className = "dot dot-red";
        pyLbl.textContent = "Python:8000 Offline";
      }
      this.state.simulatorRunning = h.simulatorRunning;
      document.getElementById("btn-sim-toggle").textContent = h.simulatorRunning
        ? "⏸ GPS Sim: ON"
        : "▶ GPS Sim: PAUSED";
    } catch (_e) {
      document.getElementById("dot-python").className = "dot dot-red";
    }
  },

  async loadAllData() {
    try {
      const [dash, veh, pbs, incs, ai, daily, disp, visits] = await Promise.all([
        this.api("/api/dashboard"),
        this.api("/api/vehicles"),
        this.api("/api/pointbooks"),
        this.api("/api/incidents"),
        this.api("/api/ai/insights"),
        this.api("/api/daily-routes"),
        this.api("/api/dispatch/state"),
        this.api("/api/visits"),
      ]);

      this.state.dashboard = dash;
      this.state.vehicles = veh.vehicles || [];
      this.state.pointBooks = pbs.point_books || [];
      this.state.incidents = incs.incidents || [];
      this.state.aiInsights = ai;
      this.state.dailyRoutes = daily;
      this.state.dispatchState = disp;
      this.state.visits = visits.visits || [];

      this.renderDashboard();
      if (window.Maps) Maps.renderAll();
      if (window.Workflows) Workflows.renderAll();
      if (window.MobileSim) MobileSim.renderAll();
    } catch (err) {
      this.toast(`Backend connecting... (${err.message}). Make sure Python FastAPI on port 8000 is running.`, "emergency");
    }
  },

  renderDashboard() {
    const d = this.state.dashboard;
    if (!d) return;
    const k = d.kpis;

    const cards = [
      { label: "Total Patrol Vehicles", val: k.total_vehicles, sub: "Patrol Cars & Blue Colts", cls: "" },
      { label: "Active Incidents", val: k.active_incidents, sub: `P1: ${k.p1_incidents} | P2: ${k.p2_incidents} | P3: ${k.p3_incidents}`, cls: "red" },
      { label: "P1 Critical (0-10m SLA)", val: k.p1_incidents, sub: "Murder / Kidnapping / Armed", cls: "pink" },
      { label: "Officers On Duty", val: k.officers_on_duty, sub: "Across 3 Daily Shifts", cls: "green" },
      { label: "Point Books Visited", val: `${k.visited_point_books}/${k.total_point_books}`, sub: `${k.visits_logged_today} check-ins logged`, cls: "" },
      { label: "Blind Spots (>12h)", val: k.blind_spots_count, sub: "AI priority escalation", cls: "amber" },
    ];

    document.getElementById("dashboard-kpis").innerHTML = cards
      .map(
        (c) => `
      <div class="kpi-card ${c.cls}">
        <div class="kpi-label">${c.label}</div>
        <div class="kpi-value">${c.val}</div>
        <div class="kpi-sub">${c.sub}</div>
      </div>`
      )
      .join("");

    // Recent Incidents table
    const incBody = document.getElementById("dash-incidents-body");
    incBody.innerHTML = d.recent_incidents
      .map(
        (i) => `
      <tr>
        <td><b>${i.incident_code}</b></td>
        <td>${i.incident_type}</td>
        <td><span class="badge badge-${i.priority.toLowerCase()}">${i.priority}</span></td>
        <td>${i.station}</td>
        <td>${i.assigned_vehicle_id ? "Unit #" + i.assigned_vehicle_id : "Pending"}</td>
        <td><span class="badge ${i.status === "Closed" ? "badge-visited" : "badge-high"}">${i.status}</span></td>
      </tr>`
      )
      .join("");

    // SHO Advisories
    const advEl = document.getElementById("dash-advisories-list");
    advEl.innerHTML = d.advisories
      .map(
        (a) => `
      <div style="padding:10px; border:1px solid var(--border-color); border-radius:8px; margin-bottom:8px; background:var(--bg-elevated);">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <b style="font-size:12.5px;">${a.title}</b>
          <span class="badge badge-${a.severity.toLowerCase() === "critical" ? "p1" : "p2"}">${a.severity}</span>
        </div>
        <div style="font-size:12px; color:var(--text-muted);">${a.action}</div>
      </div>`
      )
      .join("");

    this.renderCharts();
  },

  renderCharts() {
    if (typeof Chart === "undefined" || !this.state.dashboard) return;
    const d = this.state.dashboard;
    const textColor = this.state.theme === "dark" ? "#cbd5e1" : "#334155";

    const ctxInc = document.getElementById("chart-incidents");
    if (this.state.charts.incidents) this.state.charts.incidents.destroy();
    this.state.charts.incidents = new Chart(ctxInc, {
      type: "bar",
      data: {
        labels: ["P1 (Immediate)", "P2 (15-30m SLA)", "P3 (60m SLA)"],
        datasets: [{
          label: "Incidents by Priority",
          data: [d.priority_breakdown.P1, d.priority_breakdown.P2, d.priority_breakdown.P3],
          backgroundColor: ["#ef4444", "#f59e0b", "#3b82f6"],
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: textColor } } },
        scales: {
          x: { ticks: { color: textColor } },
          y: { beginAtZero: true, ticks: { stepSize: 1, color: textColor } },
        },
      },
    });

    const ctxSh = document.getElementById("chart-shifts");
    if (this.state.charts.shifts) this.state.charts.shifts.destroy();
    this.state.charts.shifts = new Chart(ctxSh, {
      type: "bar",
      data: {
        labels: d.shift_manpower.map((s) => s.shift_code),
        datasets: [
          {
            label: "Officers",
            data: d.shift_manpower.map((s) => s.officers),
            backgroundColor: "#0b4f8a",
            borderRadius: 5,
          },
          {
            label: "Patrol Vehicles",
            data: d.shift_manpower.map((s) => s.vehicles),
            backgroundColor: "#e91e63",
            borderRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: textColor } } },
        scales: {
          x: { ticks: { color: textColor } },
          y: { beginAtZero: true, ticks: { stepSize: 1, color: textColor } },
        },
      },
    });
  },

  initSocket() {
    if (typeof io === "undefined") return;
    this.socket = io();

    this.socket.on("telemetry:update", (payload) => {
      if (payload && payload.vehicles) {
        this.state.vehicles = payload.vehicles;
        const badge = document.getElementById("live-tick-badge");
        if (badge) badge.textContent = `GPS Live • Tick #${payload.tick}`;
        if (window.Maps) Maps.updateVehicleMarkersOnly();
      }
    });

    this.socket.on("dispatch:alert", (data) => {
      this.playSiren();
      const inc = data.incident || {};
      const veh = data.diverted_vehicle || {};
      this.toast(
        `🚨 <b>DIAL 100 ALERT (${inc.priority || "P1"})</b>: ${inc.incident_type || "Emergency"} at ${inc.location_name || "Sector"}. Diverting <b>${veh.vehicle_no || "nearest patrol"}</b>!`,
        "emergency"
      );
      this.loadAllData();
    });

    this.socket.on("visit:logged", (data) => {
      const geo = data.geofence || {};
      this.toast(
        `📍 <b>PB Check-In Synced</b> (${geo.status_label || "Logged"}) • Deviation: ${data.visit?.deviation_formatted || ""}`,
        "success"
      );
      this.loadAllData();
    });

    this.socket.on("data:refresh", () => {
      this.loadAllData();
    });
  },

  async init() {
    this.initSocket();
    await this.checkHealth();
    await this.loadAllData();
    setInterval(() => this.checkHealth(), 8000);
  },
};

window.addEventListener("DOMContentLoaded", () => App.init());
