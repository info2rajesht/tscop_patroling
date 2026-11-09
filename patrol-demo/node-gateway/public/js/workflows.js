/**
 * Operational Workflows Module:
 * - Today Route Plan (Shift 1/2/3 Plan A-D Matrix)
 * - PB Route Plan Assignment Matrix (Expandable Plan A-D + SET) & New PB Entry
 * - Dial 100 Emergency Diversion State Machine (PatrolManagement diagram)
 * - Incident Management & SLA Monitoring
 * - AI Blind Spots (>12h), Telugu-to-English Translator & TSCOP Audit Reports
 */

const Workflows = {
  expandedPBs: new Set([1]), // Expand first PB by default to showcase Plan A-D matrix!

  renderAll() {
    this.renderDailyRoutes();
    this.renderPBMatrix();
    this.renderDial100();
    this.renderIncidents();
    this.renderAIAndReports();
  },

  // -------------------------------------------------------------------------
  // 1. Today Route Plan (3 Shifts)
  // -------------------------------------------------------------------------
  renderDailyRoutes() {
    const daily = App.state.dailyRoutes;
    if (!daily) return;
    const tbody = document.getElementById("daily-routes-table-body");
    const plans = ["PLAN A", "PLAN B", "PLAN C", "PLAN D", "CUSTOM"];

    tbody.innerHTML = (daily.station_assignments || [])
      .map((st) => {
        const selectFor = (shiftId) => {
          const cur = st.shifts[String(shiftId)] || "PLAN A";
          return `<select class="select daily-plan-sel" data-station="${st.station}" data-shift="${shiftId}" style="max-width:140px;">
            ${plans.map((p) => `<option value="${p}" ${p === cur ? "selected" : ""}>${p}</option>`).join("")}
          </select>`;
        };
        return `
        <tr>
          <td><b>${st.station}</b></td>
          <td>${selectFor(1)}</td>
          <td>${selectFor(2)}</td>
          <td>${selectFor(3)}</td>
        </tr>`;
      })
      .join("");
  },

  async saveDailyRoutes() {
    if (App.state.role === "PC") {
      App.toast("Access restricted: Only SHO or Control Room can confirm daily route plans.", "emergency");
      return;
    }
    const assignments = [];
    document.querySelectorAll(".daily-plan-sel").forEach((sel) => {
      assignments.push({
        station: sel.dataset.station,
        shift_id: Number(sel.dataset.shift),
        plan_code: sel.value,
      });
    });
    try {
      await App.api("/api/daily-routes", {
        method: "POST",
        body: JSON.stringify({ assigned_by: App.state.role, assignments }),
      });
      App.toast("Today's Shift 1/2/3 Route Plans confirmed & pushed to Mobile Constable Apps!", "success");
      await App.loadAllData();
    } catch (e) {
      App.toast(`Failed to save daily routes: ${e.message}`, "emergency");
    }
  },

  // -------------------------------------------------------------------------
  // 2. PB Matrix & New Point Book Registration
  // -------------------------------------------------------------------------
  toggleNewPBForm() {
    const card = document.getElementById("new-pb-card");
    card.style.display = card.style.display === "none" ? "block" : "none";
  },

  async createPointBook() {
    const name = document.getElementById("npb-name").value.trim();
    if (!name) {
      App.toast("Please enter a Point Book Name.", "emergency");
      return;
    }
    const payload = {
      name,
      category: document.getElementById("npb-cat").value,
      pb_type: document.getElementById("npb-type").value,
      station: document.getElementById("npb-station").value,
      sector: document.getElementById("npb-sector").value || "Sector-1",
      holder_name: document.getElementById("npb-holder").value || "Security Incharge",
      holder_mobile: document.getElementById("npb-mobile").value || "9848000000",
      latitude: Number(document.getElementById("npb-lat").value) || 17.3948,
      longitude: Number(document.getElementById("npb-lon").value) || 78.4742,
      address: document.getElementById("npb-addr").value || "Hyderabad Jurisdiction",
      is_sensitive: document.getElementById("npb-sens").checked,
    };

    try {
      const res = await App.api("/api/pointbooks", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      App.toast(`Registered new Point Book <b>${res.point_book.pb_code}</b>!`, "success");
      document.getElementById("npb-name").value = "";
      this.toggleNewPBForm();
      await App.loadAllData();
    } catch (e) {
      App.toast(`Create PB failed: ${e.message}`, "emergency");
    }
  },

  togglePlanDrawer(pbId) {
    if (this.expandedPBs.has(pbId)) this.expandedPBs.delete(pbId);
    else this.expandedPBs.add(pbId);
    this.renderPBMatrix();
  },

  renderPBMatrix() {
    const q = (document.getElementById("pb-search")?.value || "").toLowerCase();
    const list = (App.state.pointBooks || []).filter(
      (p) =>
        !q ||
        p.pb_code.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.station.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );

    const tbody = document.getElementById("pb-matrix-body");
    tbody.innerHTML = list
      .map((pb, idx) => {
        const isOpen = this.expandedPBs.has(pb.id);
        const stBadge =
          pb.visit_status === "Visited" ? "badge-visited" :
          pb.visit_status === "Sensitive" ? "badge-sensitive" : "badge-nonvisited";

        const plans = pb.plans || {};
        const renderPlanCol = (planName) => {
          const pData = plans[planName] || { 1: "08:00 AM", 2: "03:00 PM", 3: "10:30 PM" };
          return `
          <div class="plan-col">
            <div class="plan-col-head">${planName}</div>
            ${[1, 2, 3]
              .map(
                (sh) => `
              <div class="plan-shift-row">
                <span class="plan-shift-label">SHIFT ${sh}</span>
                <input class="input pb-slot-input-${pb.id}" data-plan="${planName}" data-shift="${sh}" value="${pData[sh] || "09:00 AM"}" style="padding:3px 6px; font-size:11.5px;">
              </div>`
              )
              .join("")}
          </div>`;
        };

        return `
        <tr>
          <td>${idx + 1}</td>
          <td><b>${pb.pb_code}</b></td>
          <td><b>${pb.name}</b><br><span style="font-size:11px;color:var(--text-muted);">${pb.category}</span></td>
          <td>${pb.pb_type}</td>
          <td>${pb.sector}<br><span style="font-size:11px;color:var(--text-muted);">${pb.station}</span></td>
          <td>${pb.holder_name}<br><span style="font-size:11px;">${pb.holder_mobile}</span></td>
          <td style="font-family:monospace;font-size:11.5px;">${pb.latitude.toFixed(4)}, ${pb.longitude.toFixed(4)}</td>
          <td><span class="badge ${stBadge}">${pb.visit_status}</span></td>
          <td><button class="btn btn-outline btn-sm" onclick="Workflows.togglePlanDrawer(${pb.id})">${isOpen ? "▼ Hide" : "▶ Plans A-D"}</button></td>
        </tr>
        ${
          isOpen
            ? `<tr><td colspan="9" style="padding:0 10px 12px;">
                <div class="pb-plan-drawer">
                  <div class="plan-matrix-grid">
                    ${["PLAN A", "PLAN B", "PLAN C", "PLAN D"].map(renderPlanCol).join("")}
                  </div>
                  <div style="display:flex; justify-content:flex-end; margin-top:8px;">
                    <button class="btn btn-pink btn-sm" onclick="Workflows.savePBPlans(${pb.id})">SET TIMINGS</button>
                  </div>
                </div>
              </td></tr>`
            : ""
        }`;
      })
      .join("");
  },

  async savePBPlans(pbId) {
    const slots = [];
    document.querySelectorAll(`.pb-slot-input-${pbId}`).forEach((inp) => {
      slots.push({
        plan_code: inp.dataset.plan,
        shift_id: Number(inp.dataset.shift),
        scheduled_time: inp.value.trim(),
      });
    });
    try {
      await App.api(`/api/pointbooks/${pbId}/plans`, {
        method: "PUT",
        body: JSON.stringify({ slots }),
      });
      App.toast("Point Book Plan A-D shift timings saved!", "success");
      await App.loadAllData();
    } catch (e) {
      App.toast(`Failed to save PB timings: ${e.message}`, "emergency");
    }
  },

  // -------------------------------------------------------------------------
  // 3. Dial 100 Emergency Diversion State Machine
  // -------------------------------------------------------------------------
  renderDial100() {
    const d = App.state.dispatchState;
    if (!d) return;
    const sess = d.session || {};
    const st = sess.state || "ROUTE_DECIDE";

    document.getElementById("d100-state-badge").textContent = `STATE: ${st}`;

    // Highlight active flowchart node matching PatrolManagement_dark.png
    const allNodes = ["fn-root", "fn-entry", "fn-timesel", "fn-shiftofd", "fn-plans", "fn-decide", "fn-call", "fn-divert", "fn-complete", "fn-balance"];
    allNodes.forEach((id) => document.getElementById(id)?.classList.remove("active-step"));

    if (st === "ROUTE_DECIDE" || st === "CONTINUED_ROUTE") {
      document.getElementById("fn-decide")?.classList.add("active-step");
    } else if (st === "ROUTE_DIVERSION") {
      document.getElementById("fn-call")?.classList.add("active-step");
      document.getElementById("fn-divert")?.classList.add("active-step");
    } else if (st === "POINTS_BALANCE" || st === "DAY_CLOSED") {
      document.getElementById("fn-complete")?.classList.add("active-step");
      document.getElementById("fn-balance")?.classList.add("active-step");
    }

    const inc = d.incident;
    const veh = d.diverted_vehicle;
    const bal = d.points_balance || {};
    const body = document.getElementById("d100-details-body");

    body.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
        <div style="padding:10px; border-radius:8px; background:var(--bg-elevated);">
          <div style="font-size:11px; color:var(--text-muted); font-weight:700;">ASSIGNED / DIVERTED UNIT</div>
          <div style="font-size:16px; font-weight:800;">${veh ? `${veh.vehicle_no} (${veh.call_sign})` : "BC3 (On Beat)"}</div>
          <div style="font-size:12px;">Status: <span class="badge ${veh?.status === "Diverted" ? "badge-p1" : "badge-visited"}">${veh?.status || "On Patrol"}</span></div>
        </div>
        <div style="padding:10px; border-radius:8px; background:var(--bg-elevated);">
          <div style="font-size:11px; color:var(--text-muted); font-weight:700;">SHOW POINTS BALANCE</div>
          <div style="font-size:16px; font-weight:800;">${bal.visited_count ?? 0} Visited / ${bal.remaining_count ?? 0} Balance</div>
          <div style="font-size:12px;">Total Beat Points Today: <b>${bal.total_points ?? 14}</b></div>
        </div>
      </div>
      ${
        inc
          ? `<div style="padding:10px; border-left:4px solid #ef4444; background:rgba(239,68,68,0.08); border-radius:6px; margin-bottom:10px;">
              <b>Active/Last Emergency:</b> ${inc.incident_code} — ${inc.incident_type} (<span class="badge badge-${inc.priority.toLowerCase()}">${inc.priority}</span>)<br>
              <span style="font-size:12px;">Location: ${inc.location_name} (${inc.station}) • Status: <b>${inc.status}</b></span>
            </div>`
          : ""
      }
      <div style="font-size:12px; color:var(--text-muted);"><b>Log:</b> ${sess.notes || "Ready."}</div>
      ${
        bal.remaining_points?.length
          ? `<div style="margin-top:8px; font-size:11.5px;"><b>Remaining Balance Beat Points:</b> ${bal.remaining_points.map((p) => `<span class="badge badge-info" style="margin:2px;">${p.pb_code} (${p.category})</span>`).join(" ")}</div>`
          : ""
      }
    `;
  },

  async quickTriggerDial100() {
    App.switchView("dial100");
    await this.triggerDial100FromPanel();
  },

  async triggerDial100FromPanel() {
    const raw = document.getElementById("d100-type").value;
    const [incident_type, priority, lat, lon, station, location_name] = raw.split("|");
    try {
      await App.api("/api/dispatch/trigger", {
        method: "POST",
        body: JSON.stringify({
          incident_type,
          priority,
          latitude: Number(lat),
          longitude: Number(lon),
          station,
          location_name,
          description: `Live Dial 100 ${priority} call: ${incident_type} at ${location_name}.`,
        }),
      });
      await App.loadAllData();
    } catch (e) {
      App.toast(`Trigger failed: ${e.message}`, "emergency");
    }
  },

  async completeDial100Call() {
    try {
      await App.api("/api/dispatch/complete-call", {
        method: "POST",
        body: JSON.stringify({
          action_taken: "Settled",
          notes: "Emergency call completed; presenting Points Balance for SHO/PC decision.",
        }),
      });
      App.toast("Emergency call marked complete! Review Points Balance to Continue or Close Day.", "success");
      await App.loadAllData();
    } catch (e) {
      App.toast(`Complete call failed: ${e.message}`, "emergency");
    }
  },

  async decidePostCall(decision) {
    try {
      await App.api("/api/dispatch/decision", {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      App.toast(
        decision === "continue"
          ? "Patrol unit resumed beat route for remaining Point Books!"
          : "Shift day closed; remaining balance archived for next shift.",
        "success"
      );
      await App.loadAllData();
    } catch (e) {
      App.toast(`Decision failed: ${e.message}`, "emergency");
    }
  },

  // -------------------------------------------------------------------------
  // 4. Incidents & SLA Console
  // -------------------------------------------------------------------------
  renderIncidents() {
    const tbody = document.getElementById("incidents-table-body");
    tbody.innerHTML = (App.state.incidents || [])
      .map((i) => {
        const pCls = `badge-${i.priority.toLowerCase()}`;
        const slaBadge = i.sla_breached
          ? `<span class="badge badge-p1">BREACHED (${i.elapsed_minutes}m / ${i.sla_minutes}m)</span>`
          : `<span class="badge badge-visited">${i.elapsed_minutes}m / ${i.sla_minutes}m SLA</span>`;
        const actionBtn =
          i.status === "Closed"
            ? `<span style="font-size:11.5px; color:var(--text-muted);">${i.action_taken || "Closed"}</span>`
            : `<button class="btn btn-success btn-sm" onclick="Workflows.closeIncident(${i.id})">Close Case</button>`;

        return `
        <tr>
          <td><b>${i.incident_code}</b></td>
          <td>${i.incident_type}</td>
          <td><span class="badge ${pCls}">${i.priority}</span></td>
          <td><b>${i.location_name}</b><br><span style="font-size:11px;color:var(--text-muted);">${i.station}</span></td>
          <td>${i.vehicle_no || "Unassigned"}<br><span style="font-size:11px;">${i.investigating_officer || ""}</span></td>
          <td>${slaBadge}</td>
          <td><span class="badge ${i.status === "Closed" ? "badge-visited" : "badge-high"}">${i.status}</span></td>
          <td>${actionBtn}</td>
        </tr>`;
      })
      .join("");
  },

  async createIncident() {
    const payload = {
      incident_type: document.getElementById("inc-type").value,
      station: document.getElementById("inc-station").value,
      location_name: document.getElementById("inc-loc").value || "Hyderabad Sector",
      latitude: Number(document.getElementById("inc-lat").value) || 17.4565,
      longitude: Number(document.getElementById("inc-lon").value) || 78.3324,
      description: document.getElementById("inc-desc").value || "Field alert raised.",
      auto_assign: true,
    };
    try {
      const res = await App.api("/api/incidents", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const nv = res.nearest_vehicle;
      App.playSiren();
      App.toast(
        `Incident <b>${res.incident.incident_code}</b> created! Nearest unit <b>${nv ? nv.vehicle_no : "N/A"}</b> (${nv ? nv.distance_km + " km, ETA " + nv.eta_minutes + "m" : ""}) dispatched.`,
        "emergency"
      );
      await App.loadAllData();
    } catch (e) {
      App.toast(`Incident creation failed: ${e.message}`, "emergency");
    }
  },

  async closeIncident(incId, action = "Settled") {
    try {
      await App.api(`/api/incidents/${incId}/close`, {
        method: "PUT",
        body: JSON.stringify({
          action_taken: action,
          closure_comments: "Action completed and verified by patrolling unit.",
        }),
      });
      App.toast("Incident closed and patrol unit returned to normal beat.", "success");
      await App.loadAllData();
    } catch (e) {
      App.toast(`Close failed: ${e.message}`, "emergency");
    }
  },

  // -------------------------------------------------------------------------
  // 5. AI Insights, Blind Spots, Translator & Audit Reports
  // -------------------------------------------------------------------------
  async renderAIAndReports() {
    const ai = App.state.aiInsights;
    if (ai) {
      document.getElementById("ai-blindspots-body").innerHTML = (ai.blind_spots || [])
        .map(
          (b) => `
        <tr>
          <td><b>${b.pb_code}</b></td>
          <td>${b.name}<br><span style="font-size:11px;color:var(--text-muted);">${b.category}</span></td>
          <td>${b.station}</td>
          <td><b>${b.hours_since_visit} hrs</b></td>
          <td><span class="badge ${b.severity === "CRITICAL" ? "badge-p1" : "badge-p2"}">${b.severity}</span></td>
        </tr>`
        )
        .join("");
    }

    try {
      const rep = await App.api("/api/reports/analytics");
      const s = rep.summary;
      document.getElementById("reports-summary-pill").textContent =
        `Visits: ${s.total_visits} | Avg Deviation: ${s.avg_deviation_formatted} | 30m Compliance: ${s.geofence_compliance_pct}% | Dial-100 Diversions: ${s.emergency_calls_during_patrol}`;

      document.getElementById("reports-offenders-body").innerHTML = (rep.event_offender_monitor || [])
        .map(
          (e) => `
        <tr>
          <td><b>${e.event_name}</b></td>
          <td>${e.location}</td>
          <td><span class="badge badge-p2">${e.watchlist_offenders} Watchlist Subjects</span></td>
          <td>${e.assigned_unit}</td>
          <td><span class="badge badge-visited">${e.status}</span></td>
        </tr>`
        )
        .join("");

      document.getElementById("reports-audit-body").innerHTML = (rep.visits_audit || [])
        .map(
          (v) => `
        <tr>
          <td><b>${v.pb_code}</b></td>
          <td>${v.pb_name}</td>
          <td>${v.plan_code} / S${v.shift_id}</td>
          <td>${v.scheduled_time}</td>
          <td>${v.actual_time}</td>
          <td><span style="color:#e91e63;font-weight:700;">${v.deviation_formatted}</span></td>
          <td>${v.distance_meters}m ${v.geofence_ok ? "✔" : "⚠"}</td>
          <td>${v.remarks_english || "-"}</td>
        </tr>`
        )
        .join("");
    } catch (_e) {}
  },

  testTranslate(sample) {
    document.getElementById("ai-trans-input").value = sample;
    this.runTranslateSandbox();
  },

  async runTranslateSandbox() {
    const text = document.getElementById("ai-trans-input").value.trim();
    try {
      const res = await App.api("/api/ai/translate", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      document.getElementById("ai-trans-output").innerHTML = `
        <div><b>Detected Language:</b> ${res.source_language} &nbsp;|&nbsp; <b>Engine:</b> ${res.engine}</div>
        <div style="margin-top:6px;"><b>Formal English Police Log:</b> <span style="color:var(--accent-primary); font-weight:700;">${res.english_translation}</span></div>
        <div style="margin-top:4px;"><b>AI Priority Tag:</b> <span class="badge ${res.urgency.startsWith("High") ? "badge-p1" : "badge-visited"}">${res.urgency}</span></div>
      `;
    } catch (e) {
      App.toast(`Translation error: ${e.message}`, "emergency");
    }
  },
};
