/**
 * Field Constable Mobile App Simulator (Blue Colts / Patrol Car)
 * Replicates Point Books mobile wireframes + Deck mobile incident closure:
 * - Visiting Map with Visited / Sensitive / Non Visited counters
 * - POINTBOOK VISITING modal with 30m geofence simulator slider & Deviation in Time
 * - Web Speech API microphone + 1-click Telugu/Hindi voice-to-English logging
 * - Add New Point Book & Mobile Incident Action Taken / Closure
 */

const MobileSim = {
  map: null,
  layer: null,
  selectedPB: null,
  audioUsed: false,

  switchTab(tab) {
    document.querySelectorAll(".phone-tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.mtab === tab);
    });
    ["visiting", "addnew", "incidents", "myreport"].forEach((t) => {
      const el = document.getElementById(`mtab-${t}`);
      if (el) el.style.display = t === tab ? "block" : "none";
    });
    if (tab === "visiting") {
      setTimeout(() => this.invalidateMap(), 100);
    }
  },

  invalidateMap() {
    if (this.map && this.map.invalidateSize) this.map.invalidateSize();
  },

  renderAll() {
    this.renderMobileMapAndList();
    this.renderMobileIncidents();
    this.renderMobileReport();
    this.renderRecentVisitsTable();
  },

  renderMobileMapAndList() {
    const pbs = App.state.pointBooks || [];
    const visitedCnt = pbs.filter((p) => p.visit_status === "Visited").length;
    const sensCnt = pbs.filter((p) => p.visit_status === "Sensitive" || p.is_sensitive).length;
    const nonCnt = pbs.filter((p) => p.visit_status === "Non Visited").length;

    document.getElementById("m-cnt-visited").textContent = visitedCnt;
    document.getElementById("m-cnt-sens").textContent = sensCnt;
    document.getElementById("m-cnt-non").textContent = nonCnt;

    if (typeof L !== "undefined") {
      if (!this.map) {
        const el = document.getElementById("map-mobile");
        if (el) {
          this.map = L.map("map-mobile", { zoomControl: false }).setView([17.3976, 78.4712], 13);
          L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
            attribution: "&copy; OSM",
          }).addTo(this.map);
          this.layer = L.layerGroup().addTo(this.map);
        }
      }
      if (this.layer) {
        this.layer.clearLayers();
        pbs.forEach((pb) => {
          const clr = pb.visit_status === "Visited" ? "#16a34a" : pb.visit_status === "Sensitive" || pb.is_sensitive ? "#ef4444" : "#2563eb";
          const marker = L.circleMarker([pb.latitude, pb.longitude], {
            radius: 8,
            color: "#fff",
            weight: 2,
            fillColor: clr,
            fillOpacity: 0.95,
          }).addTo(this.layer);
          marker.on("click", () => this.openVisitModal(pb.id));
        });
      }
    }

    const qList = document.getElementById("mobile-pb-quicklist");
    qList.innerHTML = pbs.slice(0, 8)
      .map((pb) => {
        const dotClr = pb.visit_status === "Visited" ? "#16a34a" : pb.visit_status === "Sensitive" ? "#ef4444" : "#2563eb";
        return `
        <button onclick="MobileSim.openVisitModal(${pb.id})" style="display:flex;justify-content:space-between;align-items:center;padding:7px 9px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;cursor:pointer;text-align:left;width:100%;">
          <span><span class="dot" style="background:${dotClr};margin-right:6px;"></span><b>${pb.pb_code}</b> • ${pb.name}</span>
          <span style="font-size:10px;color:#0b4f8a;font-weight:700;">CHECK-IN →</span>
        </button>`;
      })
      .join("");
  },

  openVisitModal(pbId) {
    const pb = (App.state.pointBooks || []).find((p) => p.id === pbId);
    if (!pb) return;
    this.selectedPB = pb;
    this.audioUsed = false;

    const sched = pb.plans?.["PLAN A"]?.[1] || "10:30 AM";
    document.getElementById("mvis-banner").textContent = `📍 ${pb.name} (${pb.category})`;
    document.getElementById("mvis-id").textContent = `: ${pb.pb_code}`;
    document.getElementById("mvis-sector").textContent = `: ${pb.sector}`;
    document.getElementById("mvis-type").textContent = `: ${pb.pb_type}`;
    document.getElementById("mvis-cat").textContent = `: ${pb.category}`;
    document.getElementById("mvis-holder").textContent = `: ${pb.holder_name}`;
    document.getElementById("mvis-time").textContent = `: ${sched}`;
    document.getElementById("mvis-ps").textContent = `: ${pb.station}`;
    document.getElementById("mvis-dev").textContent = `: 00:02:30 HRS`;
    document.getElementById("mvis-remarks").value = "";
    document.getElementById("mvis-sensitive").checked = Boolean(pb.is_sensitive);
    document.getElementById("mvis-dist-slider").value = 15;
    this.updateDistancePreview(15);

    document.getElementById("phone-visit-modal").classList.add("open");
  },

  closeVisitModal() {
    document.getElementById("phone-visit-modal").classList.remove("open");
  },

  updateDistancePreview(val) {
    const d = Number(val);
    document.getElementById("mvis-dist-lbl").textContent = `${d}m`;
    const badge = document.getElementById("mvis-geo-badge");
    if (d <= 30) {
      badge.textContent = "✔ Within 30m";
      badge.style.color = "#16a34a";
    } else {
      badge.textContent = `⚠ Outside 30m (+${d - 30}m)`;
      badge.style.color = "#d97706";
    }
  },

  fillSampleVoice(key) {
    this.audioUsed = true;
    const samples = {
      telugu1: "ఏటీఎం వద్ద భద్రత బాగానే ఉంది, అనుమానాస్పద కదలికలు లేవు",
      telugu2: "కళాశాల గేటు వద్ద అనుమానాస్పద వ్యక్తులు ఉన్నారు",
      hindi1: "कॉलेज गेट के पास संदिग्ध व्यक्ति घूम रहे हैं, जांच की गई",
    };
    document.getElementById("mvis-remarks").value = samples[key] || "";
    if (key !== "telugu1") {
      document.getElementById("mvis-sensitive").checked = true;
    }
  },

  startVoiceDictation() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      App.toast("Browser SpeechRecognition unavailable; using Telugu sample voice clip instead.", "info");
      this.fillSampleVoice("telugu2");
      return;
    }
    const rec = new SpeechRec();
    rec.lang = "te-IN";
    rec.interimResults = false;
    rec.onresult = (ev) => {
      this.audioUsed = true;
      document.getElementById("mvis-remarks").value = ev.results[0][0].transcript;
    };
    rec.onerror = () => {
      App.toast("Microphone unavailable; filled Telugu sample voice transcript.", "info");
      this.fillSampleVoice("telugu2");
    };
    rec.start();
  },

  async submitVisit() {
    if (!this.selectedPB) return;
    const dist = Number(document.getElementById("mvis-dist-slider").value);
    const remarks = document.getElementById("mvis-remarks").value.trim() || "Beat point inspected; area normal.";
    const is_sensitive = document.getElementById("mvis-sensitive").checked;

    try {
      const res = await App.api("/api/visits", {
        method: "POST",
        body: JSON.stringify({
          pb_id: this.selectedPB.id,
          vehicle_id: 2,
          officer_id: 5,
          plan_code: "PLAN A",
          shift_id: 1,
          simulated_distance_m: dist,
          simulated_deviation_sec: 150,
          remarks_text: remarks,
          is_sensitive,
          audio_simulated: this.audioUsed,
        }),
      });

      this.closeVisitModal();
      const geo = res.geofence;
      const tr = res.translation;
      document.getElementById("mobile-checkin-result").innerHTML = `
        <div style="padding:12px; border-radius:8px; border-left:4px solid ${geo.within_geofence ? "#16a34a" : "#d97706"}; background:var(--bg-elevated);">
          <div style="font-weight:800; font-size:14px; margin-bottom:6px;">
            ${this.selectedPB.pb_code} Check-In Recorded (${res.new_pb_status})
          </div>
          <div><b>30m Geofence Check:</b> <span class="badge ${geo.within_geofence ? "badge-visited" : "badge-p2"}">${geo.status_label} (${geo.distance_meters}m)</span></div>
          <div style="margin-top:4px;"><b>Deviation in Time:</b> <span style="color:#e91e63; font-weight:700;">${res.visit.deviation_formatted}</span> (Scheduled: ${res.visit.scheduled_time} → Actual: ${res.visit.actual_time})</div>
          <div style="margin-top:6px;"><b>Detected Language:</b> ${tr.source_language}</div>
          <div><b>Native Transcript:</b> ${tr.original_text}</div>
          <div style="margin-top:4px;"><b>AI English Police Log:</b> <span style="color:var(--accent-primary); font-weight:700;">${tr.english_translation}</span></div>
        </div>
      `;
      await App.loadAllData();
    } catch (e) {
      App.toast(`Visit submit failed: ${e.message}`, "emergency");
    }
  },

  async submitNewPB() {
    const name = document.getElementById("m-npb-name").value.trim();
    if (!name) {
      App.toast("Enter a place name for the new Point Book.", "emergency");
      return;
    }
    const holderRaw = document.getElementById("m-npb-holder").value || "Guard, 9848011223";
    const [holder_name, holder_mobile] = holderRaw.split(",").map((s) => s.trim());
    try {
      const res = await App.api("/api/pointbooks", {
        method: "POST",
        body: JSON.stringify({
          name,
          category: document.getElementById("m-npb-cat").value,
          pb_type: document.getElementById("m-npb-type").value,
          sector: "Sector-1",
          station: "Abids PS",
          holder_name: holder_name || "Field Contact",
          holder_mobile: holder_mobile || "9848011223",
          latitude: 17.391 + (Math.random() - 0.5) * 0.01,
          longitude: 78.475 + (Math.random() - 0.5) * 0.01,
          address: document.getElementById("m-npb-addr").value || "Abids, Hyderabad",
        }),
      });
      App.toast(`Mobile Entry created <b>${res.point_book.pb_code}</b>!`, "success");
      document.getElementById("m-npb-name").value = "";
      this.switchTab("visiting");
      await App.loadAllData();
    } catch (e) {
      App.toast(`Mobile add failed: ${e.message}`, "emergency");
    }
  },

  renderMobileIncidents() {
    const el = document.getElementById("mobile-incidents-list");
    const openIncs = (App.state.incidents || []).filter((i) => i.status !== "Closed");
    if (!openIncs.length) {
      el.innerHTML = `<div style="color:#64748b;font-size:12px;">All assigned incidents are closed!</div>`;
      return;
    }
    el.innerHTML = openIncs
      .map(
        (i) => `
      <div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:8px; background:#f8fafc;">
        <div style="display:flex; justify-content:space-between; font-weight:700; font-size:12px;">
          <span>${i.incident_code} • ${i.incident_type}</span>
          <span class="badge badge-${i.priority.toLowerCase()}">${i.priority}</span>
        </div>
        <div style="font-size:11px; color:#475569; margin:4px 0;">${i.location_name}</div>
        <select class="select" id="m-act-${i.id}" style="margin:6px 0; font-size:11.5px;">
          <option value="Settled">Action: Settled</option>
          <option value="Send to Police Station">Action: Send to Police Station</option>
          <option value="False Information">Action: False Information</option>
          <option value="Issue cleared before reach time">Action: Issue cleared before reach time</option>
        </select>
        <button class="btn btn-primary btn-sm" style="width:100%; justify-content:center;" onclick="MobileSim.closeMobileIncident(${i.id})">CLOSE INCIDENT</button>
      </div>`
      )
      .join("");
  },

  async closeMobileIncident(incId) {
    const act = document.getElementById(`m-act-${incId}`).value;
    await Workflows.closeIncident(incId, act);
  },

  renderMobileReport() {
    const el = document.getElementById("mobile-myreport-list");
    el.innerHTML = (App.state.visits || []).slice(0, 6)
      .map(
        (v) => `
      <div style="border:1px solid #e2e8f0; border-radius:6px; padding:8px; margin-bottom:6px; font-size:11.5px; background:#f8fafc;">
        <div style="display:flex; justify-content:space-between;">
          <b>${v.pb_code}</b>
          <span style="color:#e91e63; font-weight:700;">${v.deviation_formatted}</span>
        </div>
        <div style="color:#334155;">${v.remarks_english}</div>
        <div style="font-size:10px; color:#64748b; margin-top:2px;">Distance: ${v.distance_meters}m (${v.geofence_ok ? "Within 30m" : "Outside 30m"})</div>
      </div>`
      )
      .join("");
  },

  renderRecentVisitsTable() {
    const tbody = document.getElementById("mobile-recent-visits-body");
    tbody.innerHTML = (App.state.visits || []).slice(0, 6)
      .map(
        (v) => `
      <tr>
        <td><b>${v.pb_code}</b></td>
        <td>${v.distance_meters}m ${v.geofence_ok ? '<span class="badge badge-visited">OK</span>' : '<span class="badge badge-p2">OUT</span>'}</td>
        <td style="color:#e91e63;font-weight:700;">${v.deviation_formatted}</td>
        <td style="font-size:11.5px;">${v.remarks_native || "-"}</td>
        <td style="font-size:11.5px;">${v.remarks_english || "-"}</td>
      </tr>`
      )
      .join("");
  },
};
