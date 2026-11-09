/**
 * GIS & Leaflet Mapping Engine
 * Handles Dashboard Live Map, Fusion Beat Planner (Area vs Crime Oriented,
 * Crime Hotspots, Crime Corridors, Planned vs Actual comparison), and 3-Shift Geo-Views.
 */

const Maps = {
  instances: {},
  tiles: {},
  layers: {},
  vehicleMarkersDash: {},
  vehicleMarkersGis: {},
  plannedResult: null,

  getTileUrl() {
    const key = localStorage.getItem("TSCOP_GOOGLE_MAPS_KEY") || "";
    return `https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}${key ? `&key=${key}` : ''}`;
  },

  ensureMap(id, center = [17.415, 78.425], zoom = 12) {
    if (typeof L === "undefined") return null;
    if (this.instances[id]) return this.instances[id];

    const el = document.getElementById(id);
    if (!el) return null;

    const map = L.map(id, { zoomControl: true }).setView(center, zoom);
    const tile = L.tileLayer(this.getTileUrl(), {
      subdomains: ['0', '1', '2', '3'],
      attribution: "&copy; Google Maps",
      maxZoom: 20,
    }).addTo(map);

    this.instances[id] = map;
    this.tiles[id] = tile;
    return map;
  },

  updateAllBasemaps() {
    const url = this.getTileUrl();
    Object.values(this.tiles).forEach((t) => {
      if (t && t.setUrl) t.setUrl(url);
    });
  },

  invalidateAll() {
    Object.values(this.instances).forEach((m) => {
      if (m && m.invalidateSize) m.invalidateSize();
    });
  },

  vehicleIcon(v) {
    const color =
      v.status === "Diverted" ? "#ef4444" :
      v.status === "Responding" ? "#f59e0b" :
      v.status === "Available" ? "#3b82f6" : "#16a34a";
    const emoji = v.vehicle_type === "Blue Colt" ? "🏍️" : "🚓";
    return L.divIcon({
      className: "",
      html: `<div style="background:${color};color:#fff;padding:3px 7px;border-radius:14px;font-size:11px;font-weight:800;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.45);white-space:nowrap;">${emoji} ${v.vehicle_no}</div>`,
      iconSize: [96, 26],
      iconAnchor: [48, 13],
    });
  },

  renderAll() {
    if (typeof L === "undefined") return;
    this.renderDashboardMap();
    this.renderGISMainMap();
    this.renderShiftMaps();
  },

  renderDashboardMap() {
    const map = this.ensureMap("map-dashboard", [17.415, 78.425], 12);
    if (!map) return;

    if (!this.layers.dash) {
      this.layers.dash = L.layerGroup().addTo(map);
    }
    this.layers.dash.clearLayers();
    this.vehicleMarkersDash = {};

    (App.state.vehicles || []).forEach((v) => {
      const m = L.marker([v.latitude, v.longitude], { icon: this.vehicleIcon(v) })
        .bindPopup(`<b>${v.vehicle_no}</b> (${v.call_sign})<br>Station: ${v.station}<br>Status: <b>${v.status}</b><br>Speed: ${v.speed_kmh} km/h`)
        .addTo(this.layers.dash);
      this.vehicleMarkersDash[v.id] = m;
    });

    (App.state.incidents || []).forEach((inc) => {
      if (inc.status === "Closed") return;
      const color = inc.priority === "P1" ? "#ef4444" : inc.priority === "P2" ? "#f59e0b" : "#3b82f6";
      L.circleMarker([inc.latitude, inc.longitude], {
        radius: 10,
        color: "#fff",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      })
        .bindPopup(`<b>🚨 ${inc.incident_code} (${inc.priority})</b><br>${inc.incident_type}<br>${inc.location_name}<br>Status: ${inc.status}`)
        .addTo(this.layers.dash);
    });
  },

  updateVehicleMarkersOnly() {
    if (typeof L === "undefined") return;
    (App.state.vehicles || []).forEach((v) => {
      const md = this.vehicleMarkersDash[v.id];
      if (md) {
        md.setLatLng([v.latitude, v.longitude]);
        md.setIcon(this.vehicleIcon(v));
      }
      const mg = this.vehicleMarkersGis[v.id];
      if (mg) {
        mg.setLatLng([v.latitude, v.longitude]);
        mg.setIcon(this.vehicleIcon(v));
      }
    });
  },

  renderGISMainMap() {
    const map = this.ensureMap("map-gis-main", [17.418, 78.42], 12);
    if (!map) return;

    if (!this.layers.gis) {
      this.layers.gis = {
        vehicles: L.layerGroup().addTo(map),
        pbs: L.layerGroup().addTo(map),
        hotspots: L.layerGroup().addTo(map),
        corridors: L.layerGroup().addTo(map),
        colleges: L.layerGroup().addTo(map),
        routes: L.layerGroup().addTo(map),
      };
    }
    this.refreshGISLayers();
  },

  refreshGISLayers() {
    const map = this.instances["map-gis-main"];
    const lg = this.layers.gis;
    if (!map || !lg) return;

    Object.values(lg).forEach((g) => g.clearLayers());
    this.vehicleMarkersGis = {};

    const showVeh = document.getElementById("layer-vehicles")?.checked;
    const showPB = document.getElementById("layer-pbs")?.checked;
    const showHot = document.getElementById("layer-hotspots")?.checked;
    const showCor = document.getElementById("layer-corridors")?.checked;
    const showCol = document.getElementById("layer-colleges")?.checked;
    const showAct = document.getElementById("layer-actual")?.checked;

    if (showVeh) {
      (App.state.vehicles || []).forEach((v) => {
        const m = L.marker([v.latitude, v.longitude], { icon: this.vehicleIcon(v) })
          .bindPopup(`<b>${v.vehicle_no}</b> (${v.vehicle_type})<br>Officer: ${v.officer_name || "On Duty"}<br>Status: ${v.status}`)
          .addTo(lg.vehicles);
        this.vehicleMarkersGis[v.id] = m;
      });
    }

    if (showPB) {
      (App.state.pointBooks || []).forEach((pb) => {
        const clr = pb.visit_status === "Visited" ? "#16a34a" : pb.visit_status === "Sensitive" || pb.is_sensitive ? "#ef4444" : "#2563eb";
        L.circleMarker([pb.latitude, pb.longitude], {
          radius: 7,
          color: "#fff",
          weight: 2,
          fillColor: clr,
          fillOpacity: 0.95,
        })
          .bindPopup(`<b>${pb.pb_code} — ${pb.name}</b><br>Category: ${pb.category} (${pb.pb_type})<br>Station: ${pb.station}<br>Status: <b>${pb.visit_status}</b>`)
          .addTo(lg.pbs);

        // 30-meter geofence perimeter indicator
        L.circle([pb.latitude, pb.longitude], {
          radius: 30,
          color: clr,
          weight: 1,
          dashArray: "3,3",
          fillOpacity: 0.08,
        }).addTo(lg.pbs);
      });
    }

    const ai = App.state.aiInsights;
    if (showHot && ai && ai.heatmap_points) {
      ai.heatmap_points.forEach(([lat, lon, weight]) => {
        L.circle([lat, lon], {
          radius: 380 * weight,
          color: "#ef4444",
          weight: 0,
          fillColor: weight > 0.78 ? "#ef4444" : "#f97316",
          fillOpacity: 0.28,
        }).addTo(lg.hotspots);
      });
    }

    if (showCor && ai && ai.crime_corridors) {
      ai.crime_corridors.forEach((cor) => {
        L.polyline(cor.coordinates, {
          color: cor.risk_level === "HIGH" ? "#ef4444" : "#f59e0b",
          weight: 6,
          opacity: 0.75,
          dashArray: "10,6",
        })
          .bindPopup(`<b>🛣️ Crime Corridor</b><br>${cor.name}<br>Risk: ${cor.risk_level}<br>Focus: ${cor.recommended_shift}`)
          .addTo(lg.corridors);
      });
    }

    if (showCol && ai && ai.predictive_hotspots) {
      ai.predictive_hotspots.forEach((ch) => {
        if (ch.kind === "College") {
          L.circle([ch.latitude, ch.longitude], {
            radius: ch.radius_m || 250,
            color: "#8b5cf6",
            weight: 2,
            fillColor: "#8b5cf6",
            fillOpacity: 0.14,
          })
            .bindPopup(`<b>🎓 ${ch.name}</b><br>Geofence: ${ch.radius_m}m<br>${ch.advisory_text}`)
            .addTo(lg.colleges);
        }
      });
    }

    if (this.plannedResult && this.plannedResult.planned_polyline?.length) {
      L.polyline(this.plannedResult.planned_polyline, {
        color: "#84cc16",
        weight: 5,
        opacity: 0.9,
      })
        .bindPopup("Planned Optimal Beat Route")
        .addTo(lg.routes);

      if (showAct && this.plannedResult.actual_polyline?.length) {
        L.polyline(this.plannedResult.actual_polyline, {
          color: "#f97316",
          weight: 3.5,
          dashArray: "6,6",
          opacity: 0.9,
        })
          .bindPopup("Actual GPS Patrol Track")
          .addTo(lg.routes);
      }
    }
  },

  async runBeatPlanner() {
    const station = document.getElementById("bp-station").value;
    const sector = document.getElementById("bp-sector").value;
    const method = document.getElementById("bp-method").value;
    const shift_id = Number(document.getElementById("bp-shift").value);

    try {
      const res = await App.api("/api/beat-planner/recommend", {
        method: "POST",
        body: JSON.stringify({ station, sector, method, shift_id, route_name: "Recommended-Route" }),
      });
      this.plannedResult = res;
      document.getElementById("planner-distance-badge").textContent = `Distance: ${res.total_distance_km} Kms`;

      const tbody = document.getElementById("bp-points-body");
      tbody.innerHTML = (res.ordered_points || [])
        .map(
          (p, i) => `
        <tr>
          <td><b>${i + 1}</b></td>
          <td><b>${p.pb_code}</b><br><span style="font-size:11px;color:var(--text-muted);">${p.name}</span></td>
          <td>${p.category} ${p.is_sensitive ? '<span class="badge badge-p1">Sensitive</span>' : ""}</td>
          <td>${p.scheduled_time || "09:00 AM"}</td>
          <td>${p.leg_distance_km} km</td>
        </tr>`
        )
        .join("");

      this.refreshGISLayers();
      const map = this.instances["map-gis-main"];
      if (map && res.planned_polyline?.length) {
        map.fitBounds(L.latLngBounds(res.planned_polyline), { padding: [35, 35] });
      }
      App.toast(`Generated <b>${method}</b> beat route (${res.total_distance_km} km across ${res.ordered_points.length} Point Books).`, "success");
    } catch (e) {
      App.toast(`Beat Planner error: ${e.message}`, "emergency");
    }
  },

  clearPlannedRoute() {
    this.plannedResult = null;
    document.getElementById("planner-distance-badge").textContent = "Distance: 0 Kms";
    document.getElementById("bp-points-body").innerHTML = "";
    this.refreshGISLayers();
  },

  renderShiftMaps() {
    const daily = App.state.dailyRoutes;
    if (!daily || !daily.shift_views) return;

    [1, 2, 3].forEach((sId) => {
      const mapId = `map-shift-${sId}`;
      const map = this.ensureMap(mapId, [17.415, 78.43], 11);
      if (!map) return;

      if (!this.layers[mapId]) {
        this.layers[mapId] = L.layerGroup().addTo(map);
      }
      this.layers[mapId].clearLayers();

      const markers = daily.shift_views[`shift_${sId}`] || [];
      const badgeEl = document.getElementById(`badge-s${sId}-count`);
      if (badgeEl) badgeEl.textContent = `${markers.length} Points`;

      markers.forEach((pt) => {
        const cls = pt.visit_status === "Visited" ? "visited" : pt.is_sensitive ? "sensitive" : "";
        const icon = L.divIcon({
          className: "",
          html: `<div class="time-pin-label ${cls}">${pt.category.toUpperCase()} ${pt.scheduled_time}</div>`,
          iconSize: [120, 22],
          iconAnchor: [60, 11],
        });
        L.marker([pt.latitude, pt.longitude], { icon })
          .bindPopup(`<b>${pt.pb_code} — ${pt.name}</b><br>Station: ${pt.station}<br>Active Plan: <b>${pt.plan_code}</b><br>Scheduled: <b>${pt.scheduled_time}</b>`)
          .addTo(this.layers[mapId]);
      });
    });
  },
};
