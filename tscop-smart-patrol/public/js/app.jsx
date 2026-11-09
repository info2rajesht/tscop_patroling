/**
 * ============================================================================
 * TSCOP / Fusion safeOS Smart Patrol Management System
 * React 18 Application - Complete Architecture & UI Implementation
 * Includes Historical Intelligence Engine (Last Month Data) + SHO Overrides
 * ============================================================================
 */

const { useState, useEffect, useRef } = React;

// --- Web Audio API Police Siren Synthesizer ---
function playPoliceSiren() {
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
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.linearRampToValueAtTime(950, now + 0.4);
    osc.frequency.linearRampToValueAtTime(500, now + 0.8);
    osc.frequency.linearRampToValueAtTime(950, now + 1.2);
    osc.frequency.linearRampToValueAtTime(500, now + 1.6);
    osc.start(now);
    osc.stop(now + 1.65);
  } catch (_e) {}
}

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [theme, setTheme] = useState("light");
  const [role, setRole] = useState("SHO");
  const [dashboard, setDashboard] = useState(null);
  const [historical, setHistorical] = useState(null);
  const [pointBooks, setPointBooks] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [dailyRoutes, setDailyRoutes] = useState({});
  const [dispatchSession, setDispatchSession] = useState({ state: "ROUTE_DECIDE" });
  const [toast, setToast] = useState(null);
  const [expandedPBs, setExpandedPBs] = useState({ 1: true });

  // SHO Override Form State
  const [selectedPBCode, setSelectedPBCode] = useState("PB-COL-01");
  const [overrideShift, setOverrideShift] = useState("Shift 1");
  const [overrideTiming, setOverrideTiming] = useState("08:25 AM");
  const [overrideReason, setOverrideReason] = useState("College assembly commences early; presence required 15 mins prior.");

  // Mobile Simulator State
  const [mobileTab, setMobileTab] = useState("visiting");
  const [selectedVisitPB, setSelectedVisitPB] = useState(null);
  const [visitDistance, setVisitDistance] = useState(15);
  const [visitRemarks, setVisitRemarks] = useState("");
  const [visitSensitive, setVisitSensitive] = useState(false);
  const [recentVisits, setRecentVisits] = useState([]);

  // Speech-to-Text (Microphone) & Google Language Translator State
  const [speechLang, setSpeechLang] = useState("te-IN"); // 'te-IN', 'hi-IN', 'en-IN'
  const [isListening, setIsListening] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedText, setTranslatedText] = useState("");
  const [detectedLangName, setDetectedLangName] = useState("");
  const [translationProvider, setTranslationProvider] = useState("");
  const recognitionRef = useRef(null);

  // Google Maps API Key & Provider Configuration
  const [googleMapsKey, setGoogleMapsKey] = useState(() => localStorage.getItem("TSCOP_GOOGLE_MAPS_KEY") || "");
  const [mapProvider, setMapProvider] = useState(() => localStorage.getItem("TSCOP_MAP_PROVIDER") || "google-roadmap");
  const [showMapModal, setShowMapModal] = useState(false);
  const [keyInput, setKeyInput] = useState(googleMapsKey);
  const tileLayerRef = useRef(null);

  // Map references
  const mapDashRef = useRef(null);
  const mapDashInstance = useRef(null);
  const vehicleMarkers = useRef({});
  const mapShift1Ref = useRef(null);
  const mapShift2Ref = useRef(null);
  const mapShift3Ref = useRef(null);

  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Toggle Dark Theme
  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.body.classList.toggle("dark", next === "dark");
  };

  // Fetch Core Data
  const loadData = async () => {
    try {
      const [dashRes, histRes, pbRes, incRes, routeRes] = await Promise.all([
        fetch("/api/dashboard").then(r => r.json()),
        fetch("/api/historical/recommendations").then(r => r.json()),
        fetch("/api/pointbooks").then(r => r.json()),
        fetch("/api/incidents").then(r => r.json()),
        fetch("/api/daily-routes").then(r => r.json()),
      ]);
      setDashboard(dashRes);
      setVehicles(dashRes.vehicles || []);
      setHistorical(histRes);
      setPointBooks(pbRes.point_books || []);
      setIncidents(incRes.incidents || []);
      setDailyRoutes(routeRes.assignments || {});
    } catch (e) {
      console.error("Fetch error", e);
    }
  };

  useEffect(() => {
    loadData();

    // Setup Live Server-Sent Events (SSE) for Real-Time Telemetry & Alerts
    const sse = new EventSource("/events");

    sse.addEventListener("telemetry:update", e => {
      const data = JSON.parse(e.data);
      if (data.vehicles) {
        setVehicles(data.vehicles);
        // Update Leaflet marker coordinates in real time
        data.vehicles.forEach(v => {
          if (vehicleMarkers.current[v.id]) {
            vehicleMarkers.current[v.id].setLatLng([v.latitude, v.longitude]);
          }
        });
      }
    });

    sse.addEventListener("dispatch:alert", e => {
      const data = JSON.parse(e.data);
      setDispatchSession(data);
      playPoliceSiren();
      showToast(`🚨 DIAL 100 ALERT: ${data.incident.type} at ${data.incident.location}. Unit ${data.diverted_vehicle?.vehicle_no} Diverted!`, "error");
      loadData();
    });

    sse.addEventListener("sho:override", e => {
      const data = JSON.parse(e.data);
      showToast(`👮 SHO Override Confirmed: ${data.message}`, "success");
      loadData();
    });

    sse.addEventListener("visit:logged", e => {
      const data = JSON.parse(e.data);
      showToast(`📍 Check-In Recorded for ${data.visit.pb_code} (${data.geofence.status_label})`, "success");
      loadData();
    });

    sse.addEventListener("data:refresh", () => loadData());

    return () => sse.close();
  }, []);

  const getTileLayer = (provider, key) => {
    if (provider === "google-satellite") {
      return L.tileLayer(`https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}${key ? `&key=${key}` : ''}`, {
        subdomains: ['0', '1', '2', '3'],
        attribution: '&copy; Google Maps (Satellite)',
        maxZoom: 20
      });
    }
    if (provider === "google-hybrid") {
      return L.tileLayer(`https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}${key ? `&key=${key}` : ''}`, {
        subdomains: ['0', '1', '2', '3'],
        attribution: '&copy; Google Maps (Hybrid)',
        maxZoom: 20
      });
    }
    if (provider === "google-terrain") {
      return L.tileLayer(`https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}${key ? `&key=${key}` : ''}`, {
        subdomains: ['0', '1', '2', '3'],
        attribution: '&copy; Google Maps (Terrain)',
        maxZoom: 20
      });
    }
    if (provider === "osm") {
      return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
      });
    }
    // Default: google-roadmap
    return L.tileLayer(`https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}${key ? `&key=${key}` : ''}`, {
      subdomains: ['0', '1', '2', '3'],
      attribution: '&copy; Google Maps',
      maxZoom: 20
    });
  };

  // Initialize and update Dashboard Map & Base Tile Layer
  useEffect(() => {
    if (activeTab === "dashboard" && mapDashRef.current && window.L) {
      if (!mapDashInstance.current) {
        const map = L.map(mapDashRef.current).setView([17.415, 78.43], 12);
        mapDashInstance.current = map;
      }
      
      const map = mapDashInstance.current;
      if (tileLayerRef.current) {
        try { map.removeLayer(tileLayerRef.current); } catch (_e) {}
      }
      const newLayer = getTileLayer(mapProvider, googleMapsKey).addTo(map);
      tileLayerRef.current = newLayer;
    }

    if (mapDashInstance.current && vehicles.length > 0) {
      vehicles.forEach(v => {
        if (!vehicleMarkers.current[v.id]) {
          const icon = L.divIcon({
            className: "",
            html: `<div style="background:${v.status === 'Diverted' ? '#ef4444' : '#0b4f8a'};color:#fff;padding:2px 6px;border-radius:12px;font-size:10px;font-weight:bold;white-space:nowrap;border:2px solid #fff;">🚓 ${v.vehicle_no}</div>`,
            iconSize: [85, 24],
          });
          const m = L.marker([v.latitude, v.longitude], { icon }).addTo(mapDashInstance.current);
          vehicleMarkers.current[v.id] = m;
        } else {
          vehicleMarkers.current[v.id].setLatLng([v.latitude, v.longitude]);
        }
      });
    }
  }, [activeTab, vehicles, mapProvider, googleMapsKey, theme]);

  // Handle SHO Override Submission
  const handleApplySHOOverride = async () => {
    try {
      const res = await fetch("/api/historical/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pb_code: selectedPBCode,
          field: overrideShift,
          new_timing: overrideTiming,
          reason: overrideReason,
          authorized_by: `SHO Inspector K. Ravinder`,
        }),
      }).then(r => r.json());

      if (res.error) throw new Error(res.error);
      showToast(res.message, "success");
      loadData();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  // Trigger Dial 100 Emergency
  const handleTriggerDial100 = async (incidentType = "Murder", priority = "P1") => {
    try {
      const res = await fetch("/api/dispatch/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_type: incidentType,
          priority: priority,
          location_name: "Tilak Road Jewelry Lane, Abids",
        }),
      }).then(r => r.json());

      setDispatchSession(res);
      playPoliceSiren();
      showToast(`🚨 Dial 100 Emergency Dispatched! Nearest Unit Diverted.`, "error");
      setActiveTab("dial100");
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  // Complete Dial 100 Call
  const handleCompleteCall = async () => {
    try {
      const res = await fetch("/api/dispatch/complete", { method: "POST" }).then(r => r.json());
      setDispatchSession(res);
      showToast("Call marked complete. Review Points Balance to Continue or Close Day.", "info");
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  // Post-Call Decision
  const handleDispatchDecision = async (decision) => {
    try {
      const res = await fetch("/api/dispatch/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      }).then(r => r.json());
      setDispatchSession(res);
      showToast(res.message, "success");
      loadData();
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  // --- Speech-to-Text (Microphone) & Google Language Translator Hooks ---
  useEffect(() => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRec) {
      try {
        const rec = new SpeechRec();
        rec.continuous = false;
        rec.interimResults = true;
        rec.lang = speechLang;

        rec.onstart = () => {
          setIsListening(true);
        };

        rec.onresult = (event) => {
          let interim = "";
          let final = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }
          const text = (final || interim).trim();
          if (text) {
            setVisitRemarks(text);
          }
          if (final) {
            triggerGoogleTranslation(final, speechLang);
          }
        };

        rec.onerror = (e) => {
          console.warn("Speech recognition error:", e);
          setIsListening(false);
          if (e.error === "not-allowed") {
            showToast("Microphone access denied. Please grant microphone permissions in browser or click a quick sample voice chip.", "warning");
          }
        };

        rec.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = rec;
      } catch (err) {
        console.warn("Speech recognition init error:", err);
      }
    }
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (_) {}
      }
    };
  }, [speechLang]);

  // Toggle Microphone Listening
  const toggleListening = () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast("Speech Recognition is not natively supported in this browser. Please use Chrome/Edge or click a quick voice sample chip below.", "warning");
      return;
    }
    if (isListening) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (_) {}
      }
      setIsListening(false);
    } else {
      try {
        if (recognitionRef.current) {
          recognitionRef.current.lang = speechLang;
          recognitionRef.current.start();
          setIsListening(true);
          const langLabel = speechLang === 'te-IN' ? 'Telugu' : speechLang === 'hi-IN' ? 'Hindi' : 'English';
          showToast(`🎤 Microphone active: Speak now in ${langLabel}...`, "info");
        }
      } catch (e) {
        console.warn("Mic start error:", e);
        setIsListening(false);
      }
    }
  };

  // Google Language Translator caller
  const triggerGoogleTranslation = async (textToTranslate, langCode) => {
    const query = (textToTranslate !== undefined ? textToTranslate : visitRemarks || "").trim();
    if (!query) return;
    setIsTranslating(true);
    try {
      const res = await fetch("/api/translate/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: query,
          source_lang: langCode || speechLang,
          target_lang: "en",
        }),
      }).then(r => r.json());

      if (res && res.english_translation) {
        setTranslatedText(res.english_translation);
        setDetectedLangName(res.detected_language || (speechLang === 'te-IN' ? 'Telugu (తెలుగు)' : 'Hindi (हिंदी)'));
        setTranslationProvider(res.provider || 'Google Language Translator');
        if (res.urgency && res.urgency.startsWith('High')) {
          setVisitSensitive(true);
        }
      }
    } catch (err) {
      console.warn("Translation API error:", err);
    } finally {
      setIsTranslating(false);
    }
  };

  // Select Quick Voice Sample
  const handleSelectVoiceSample = (sampleText, sampleLang = "te-IN") => {
    setSpeechLang(sampleLang);
    setVisitRemarks(sampleText);
    triggerGoogleTranslation(sampleText, sampleLang);
  };

  // Mobile Check-In Submit with Google Translation & Speech Metadata
  const handleMobileSubmitVisit = async () => {
    if (!selectedVisitPB) return;
    try {
      const res = await fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pb_id: selectedVisitPB.id,
          simulated_distance_m: visitDistance,
          remarks_text: visitRemarks || "Routine beat check completed.",
          remarks_english: translatedText || undefined,
          detected_language: detectedLangName || undefined,
          translation_provider: translationProvider || undefined,
          source_lang: speechLang,
          is_sensitive: visitSensitive,
        }),
      }).then(r => r.json());

      showToast(`Check-In verified: ${res.visit.pb_code} (${res.geofence.status_label})`, "success");
      setSelectedVisitPB(null);
      setVisitRemarks("");
      setTranslatedText("");
      setDetectedLangName("");
      setTranslationProvider("");
      loadData();
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900 transition-colors">
      
      {/* --- Top Command Header --- */}
      <header className="bg-police text-white border-b-4 border-police-pink px-4 py-3 sticky top-0 z-50 shadow-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white text-police font-extrabold flex items-center justify-center border-2 border-police-pink text-sm shadow">
            TSCOP
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-wide flex items-center gap-2">
              Patrol &amp; Beat Management <span className="opacity-75 font-normal text-xs bg-white/20 px-2 py-0.5 rounded">Fusion safeOS</span>
            </h1>
            <p className="text-xs text-blue-100">Live AI Intelligence &amp; Dispatch Command Center (Port 3000)</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="bg-white/10 px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 border border-white/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Telemetry Stream Live
          </div>

          {/* Role Persona Switcher */}
          <select 
            value={role} 
            onChange={e => setRole(e.target.value)}
            className="bg-white/20 text-white text-xs rounded-md px-2 py-1.5 border border-white/30 focus:outline-none focus:ring-1 focus:ring-police-pink"
          >
            <option value="SHO" className="text-slate-900">Persona: SHO (Full Override Rights)</option>
            <option value="ADMIN" className="text-slate-900">Persona: Control Room Dispatcher</option>
            <option value="PC" className="text-slate-900">Persona: Field Constable (BC3)</option>
          </select>

          <button 
            onClick={() => { setKeyInput(googleMapsKey); setShowMapModal(true); }}
            className="bg-white/20 hover:bg-white/30 px-2.5 py-1.5 rounded-md text-xs font-medium border border-white/30 flex items-center gap-1.5 shadow-sm"
            title="Configure Google Maps API Key & Satellite/Roadmap Layers"
          >
            <span>🗺️</span>
            <span>{googleMapsKey ? 'Google Maps: Key Active' : 'Set Google Maps Key'}</span>
          </button>

          <button onClick={toggleTheme} className="bg-white/20 hover:bg-white/30 px-2.5 py-1.5 rounded-md text-xs font-medium border border-white/30">
            {theme === "light" ? "🌙 Dark (Fusion)" : "☀️ Light (TSCOP)"}
          </button>

          <button onClick={() => playPoliceSiren()} className="bg-white/20 hover:bg-white/30 px-2.5 py-1.5 rounded-md text-xs font-medium border border-white/30">
            🔊 Siren Test
          </button>

          <button onClick={() => handleTriggerDial100("Murder", "P1")} className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow-lg border border-rose-400 badge-pulse">
            🚨 Dial 100 Emergency
          </button>
        </div>
      </header>

      {/* --- Main App Body --- */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Sidebar Navigation */}
        <aside className="w-64 bg-slate-800 text-slate-200 border-r border-slate-700 p-3 flex flex-col gap-1 flex-shrink-0">
          <div className="text-[10px] uppercase font-bold text-slate-400 px-3 pt-2 pb-1 tracking-wider">Command &amp; Analytics</div>
          
          <button onClick={() => setActiveTab("dashboard")} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold w-full text-left transition ${activeTab === 'dashboard' ? 'bg-police-pink text-white shadow' : 'hover:bg-slate-700/60'}`}>
            📊 Command Dashboard
          </button>

          <button onClick={() => setActiveTab("historical")} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold w-full text-left transition ${activeTab === 'historical' ? 'bg-police-pink text-white shadow' : 'hover:bg-slate-700/60'}`}>
            🧠 Last Month AI Beat &amp; Timing Recommender
          </button>

          <button onClick={() => setActiveTab("today-routes")} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold w-full text-left transition ${activeTab === 'today-routes' ? 'bg-police-pink text-white shadow' : 'hover:bg-slate-700/60'}`}>
            📅 Today Route Plan (3 Shifts)
          </button>

          <div className="text-[10px] uppercase font-bold text-slate-400 px-3 pt-4 pb-1 tracking-wider">Beat Management &amp; Mobile</div>

          <button onClick={() => setActiveTab("pb-matrix")} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold w-full text-left transition ${activeTab === 'pb-matrix' ? 'bg-police-pink text-white shadow' : 'hover:bg-slate-700/60'}`}>
            📘 PB Route Plan Matrix (Plan A-D)
          </button>

          <button onClick={() => setActiveTab("dial100")} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold w-full text-left transition ${activeTab === 'dial100' ? 'bg-police-pink text-white shadow' : 'hover:bg-slate-700/60'}`}>
            🚨 Dial 100 Route Diversion Flow
          </button>

          <button onClick={() => setActiveTab("mobile-sim")} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold w-full text-left transition ${activeTab === 'mobile-sim' ? 'bg-police-pink text-white shadow' : 'hover:bg-slate-700/60'}`}>
            📱 Field Constable Mobile Simulator
          </button>

          <button onClick={() => setActiveTab("incidents")} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold w-full text-left transition ${activeTab === 'incidents' ? 'bg-police-pink text-white shadow' : 'hover:bg-slate-700/60'}`}>
            ⚠️ Incidents &amp; SLA Console
          </button>

          <div className="mt-auto p-3 bg-slate-900/60 rounded-lg text-[11px] text-slate-400 border border-slate-700">
            <div className="font-bold text-white mb-0.5">Role: {role}</div>
            <div>{role === "SHO" ? "Full authority to overwrite timings & beat plans." : "View & operation access active."}</div>
          </div>
        </aside>

        {/* Workspace Views */}
        <main className="flex-1 p-5 overflow-y-auto">
          
          {/* Toast Notification */}
          {toast && (
            <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg text-white font-medium text-xs shadow-2xl flex items-center gap-2 ${toast.type === 'error' ? 'bg-rose-600' : 'bg-emerald-600'}`}>
              {toast.msg}
            </div>
          )}

          {/* ==============================================================
              VIEW 1: COMMAND DASHBOARD
              ============================================================== */}
          {activeTab === "dashboard" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-police dark:text-blue-400">Police Command &amp; Telemetry Dashboard</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Live patrol vehicles, 3-shift presence, active incident SLAs, and last-month crime density</p>
              </div>

              {/* KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                <div className="glass-card p-3.5 border-t-4 border-police">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Patrol Fleet Live</div>
                  <div className="text-2xl font-black mt-1 text-slate-800 dark:text-white">{dashboard?.kpis.total_vehicles || 6} Units</div>
                  <div className="text-[11px] text-emerald-600 mt-0.5">🚓 On Beat &amp; Available</div>
                </div>

                <div className="glass-card p-3.5 border-t-4 border-rose-500">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Active Incidents</div>
                  <div className="text-2xl font-black mt-1 text-rose-600">{dashboard?.kpis.active_incidents || 3} Calls</div>
                  <div className="text-[11px] text-slate-500">P1 Critical: {dashboard?.kpis.p1_incidents || 2}</div>
                </div>

                <div className="glass-card p-3.5 border-t-4 border-police-pink">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Point Books Visited</div>
                  <div className="text-2xl font-black mt-1 text-police-pink">{dashboard?.kpis.visited_point_books || 3}/{dashboard?.kpis.total_point_books || 8}</div>
                  <div className="text-[11px] text-slate-500">Shift 1 target in progress</div>
                </div>

                <div className="glass-card p-3.5 border-t-4 border-amber-500">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">SHO Plan Overrides</div>
                  <div className="text-2xl font-black mt-1 text-amber-600">{dashboard?.kpis.sho_overrides_count || 1} Active</div>
                  <div className="text-[11px] text-slate-500">Customized by SHO Inspector</div>
                </div>
              </div>

              {/* Map & Active Incidents Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 glass-card p-3">
                  <div className="flex justify-between items-center mb-2 px-1 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-police dark:text-blue-400">
                        Live Hyderabad Fleet ({mapProvider.replace('-', ' ').toUpperCase()})
                      </span>
                      {googleMapsKey && <span className="text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 px-1.5 py-0.5 rounded font-bold">Google Key Active</span>}
                    </div>
                    <div className="flex items-center gap-1 text-[11px]">
                      <button 
                        onClick={() => { setMapProvider('google-roadmap'); localStorage.setItem('TSCOP_MAP_PROVIDER', 'google-roadmap'); }}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${mapProvider === 'google-roadmap' ? 'bg-police text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}`}
                      >
                        🚗 Roadmap
                      </button>
                      <button 
                        onClick={() => { setMapProvider('google-satellite'); localStorage.setItem('TSCOP_MAP_PROVIDER', 'google-satellite'); }}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${mapProvider === 'google-satellite' ? 'bg-police text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}`}
                      >
                        🛰️ Satellite
                      </button>
                      <button 
                        onClick={() => { setMapProvider('google-hybrid'); localStorage.setItem('TSCOP_MAP_PROVIDER', 'google-hybrid'); }}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${mapProvider === 'google-hybrid' ? 'bg-police text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}`}
                      >
                        🌐 Hybrid
                      </button>
                      <button 
                        onClick={() => { setMapProvider('osm'); localStorage.setItem('TSCOP_MAP_PROVIDER', 'osm'); }}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${mapProvider === 'osm' ? 'bg-police text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}`}
                      >
                        🗺️ OSM
                      </button>
                      <button 
                        onClick={() => { setKeyInput(googleMapsKey); setShowMapModal(true); }}
                        className="ml-1 text-[10px] text-police-pink underline font-bold"
                      >
                        ⚙️ Key
                      </button>
                    </div>
                  </div>
                  <div ref={mapDashRef} className="h-80 rounded-lg border border-slate-200 dark:border-slate-700"></div>
                </div>

                <div className="glass-card p-4 space-y-3">
                  <h3 className="font-bold text-xs uppercase text-slate-500 tracking-wider">Active Incident Queue</h3>
                  <div className="space-y-2">
                    {(incidents || []).slice(0, 4).map(inc => (
                      <div key={inc.id} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs">
                        <div className="flex justify-between font-bold">
                          <span>{inc.incident_code} • {inc.incident_type}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${inc.priority === 'P1' ? 'bg-rose-100 text-rose-700 font-bold' : 'bg-amber-100 text-amber-700'}`}>{inc.priority}</span>
                        </div>
                        <div className="text-slate-600 dark:text-slate-300 mt-1">{inc.location_name}</div>
                        <div className="text-[10px] text-slate-400 mt-1">Assigned: {inc.assigned_vehicle || "Pending"} | SLA: {inc.sla_minutes}m</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==============================================================
              VIEW 2: HISTORICAL INTELLIGENCE & SHO OVERRIDE (LAST MONTH DATA)
              ============================================================== */}
          {activeTab === "historical" && (
            <div className="space-y-5">
              <div className="flex justify-between items-start flex-wrap gap-2">
                <div>
                  <h2 className="text-xl font-extrabold text-police dark:text-blue-400 flex items-center gap-2">
                    🧠 AI Beat &amp; Timing Recommender (Based on Last Month Data)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Analyzes 30-day incident frequency and temporal crime patterns. SHO has full authority to inspect and overwrite timings.
                  </p>
                </div>
                <span className="text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 px-3 py-1 rounded-full border border-amber-300">
                  {historical?.total_historical_incidents || 12} Historical Incidents Evaluated (Oct 10 - Nov 09)
                </span>
              </div>

              {/* SHO Interactive Override & Adjustment Panel */}
              <div className="glass-card p-4 border-2 border-police-pink bg-pink-50/20 dark:bg-slate-800">
                <div className="flex items-center justify-between mb-3 border-b border-slate-200 dark:border-slate-700 pb-2">
                  <div className="font-bold text-sm text-police dark:text-pink-400 flex items-center gap-2">
                    👮 SHO Overwrite &amp; Authorization Console
                  </div>
                  <span className="text-[11px] text-slate-500">Authorized Role: <b>{role}</b></span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">Target Beat Point</label>
                    <select 
                      value={selectedPBCode} 
                      onChange={e => setSelectedPBCode(e.target.value)}
                      className="w-full text-xs p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    >
                      {(historical?.recommendations || []).map(r => (
                        <option key={r.pb_code} value={r.pb_code}>
                          {r.pb_code} - {r.name} ({r.category})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">Operational Shift</label>
                    <select 
                      value={overrideShift} 
                      onChange={e => setOverrideShift(e.target.value)}
                      className="w-full text-xs p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    >
                      <option value="Shift 1">Shift 1 (06:00 AM - 02:00 PM)</option>
                      <option value="Shift 2">Shift 2 (02:00 PM - 10:00 PM)</option>
                      <option value="Shift 3">Shift 3 (10:00 PM - 06:00 AM)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">New Visit Timing</label>
                    <input 
                      type="text" 
                      value={overrideTiming} 
                      onChange={e => setOverrideTiming(e.target.value)}
                      placeholder="e.g. 08:25 AM" 
                      className="w-full text-xs p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">SHO Operational Reason</label>
                    <input 
                      type="text" 
                      value={overrideReason} 
                      onChange={e => setOverrideReason(e.target.value)}
                      className="w-full text-xs p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <button 
                    onClick={handleApplySHOOverride} 
                    className="bg-police-pink hover:bg-pink-700 text-white font-bold text-xs px-4 py-2 rounded shadow transition"
                  >
                    ✔ APPLY SHO OVERRIDE &amp; SYNC TO FIELD CONSTABLES
                  </button>
                </div>
              </div>

              {/* AI Recommendations Table */}
              <div className="glass-card p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-sm">Last Month Temporal Analysis &amp; Suggested Timings</h3>
                  <span className="text-xs text-slate-500">Sorted by Crime Risk Score</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500">
                        <th className="p-2.5">PB Code</th>
                        <th className="p-2.5">Location &amp; Category</th>
                        <th className="p-2.5">Last Month Incidents</th>
                        <th className="p-2.5">Risk Score</th>
                        <th className="p-2.5">AI Suggested Timings</th>
                        <th className="p-2.5">Rationale Based on Last Month Data</th>
                        <th className="p-2.5">SHO Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {(historical?.recommendations || []).map(r => (
                        <tr key={r.pb_code} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <td className="p-2.5 font-bold text-police dark:text-blue-400">{r.pb_code}</td>
                          <td className="p-2.5">
                            <b>{r.name}</b>
                            <div className="text-[11px] text-slate-500">{r.category} • {r.sector}</div>
                          </td>
                          <td className="p-2.5">
                            <span className="font-bold text-rose-600">{r.last_month_incidents} logged</span>
                            <div className="text-[10px] text-slate-400">{r.crime_types.slice(0, 1).join(", ")}</div>
                          </td>
                          <td className="p-2.5">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${r.risk_score >= 80 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                              {r.risk_score}/100
                            </span>
                          </td>
                          <td className="p-2.5 font-mono text-[11px]">
                            <div>S1: <b>{r.ai_timings.shift_1}</b></div>
                            <div>S2: <b>{r.ai_timings.shift_2}</b></div>
                            <div>S3: <b>{r.ai_timings.shift_3}</b></div>
                          </td>
                          <td className="p-2.5 text-slate-600 dark:text-slate-300 max-w-xs">{r.rationale}</td>
                          <td className="p-2.5">
                            {r.has_sho_override ? (
                              <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 px-2 py-0.5 rounded font-bold text-[10px]">
                                SHO MODIFIED
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">AI Baseline</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SHO Audit Trail */}
              <div className="glass-card p-4">
                <h3 className="font-bold text-xs uppercase text-slate-500 mb-2">Audit History of SHO Changes</h3>
                <div className="space-y-2">
                  {(historical?.all_overrides || []).map((o, idx) => (
                    <div key={idx} className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-xs flex justify-between items-center">
                      <div>
                        <b>{o.pb_code}</b> ({o.field}): Modified to <b>{o.sho_modified}</b>
                        <div className="text-[11px] text-slate-500">{o.reason}</div>
                      </div>
                      <div className="text-right text-[10px] text-slate-400">
                        <div>{o.authorized_by}</div>
                        <div>{new Date(o.timestamp).toLocaleTimeString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ==============================================================
              VIEW 3: TODAY ROUTE PLAN (3 SHIFTS)
              ============================================================== */}
          {activeTab === "today-routes" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-extrabold text-police dark:text-blue-400">Today Route Plan &amp; 3-Shift Geo-Graphical View</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Non-predictable daily rotation of Plan A, B, C, D across Shift 1, Shift 2, Shift 3</p>
                </div>
                <button onClick={() => showToast("Today Route Plans confirmed & deployed to field units!", "success")} className="bg-police-pink text-white font-bold text-xs px-4 py-2 rounded shadow">
                  ✔ SUBMIT TODAY'S ROUTE PLAN
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="glass-card p-3">
                  <div className="font-bold text-xs bg-police text-white p-2 rounded-t -m-3 mb-2 flex justify-between">
                    <span>SHIFT 1 (06:00 - 14:00)</span>
                    <span>PLAN A</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between">
                      <span>Nampally Junior College</span>
                      <b className="text-police dark:text-blue-400">08:25 AM</b>
                    </div>
                    <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between">
                      <span>Andhra Bank ATM</span>
                      <b className="text-police dark:text-blue-400">10:30 AM</b>
                    </div>
                    <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between">
                      <span>Public Gardens South Gate</span>
                      <b className="text-police dark:text-blue-400">11:45 AM</b>
                    </div>
                  </div>
                </div>

                <div className="glass-card p-3">
                  <div className="font-bold text-xs bg-police text-white p-2 rounded-t -m-3 mb-2 flex justify-between">
                    <span>SHIFT 2 (14:00 - 22:00)</span>
                    <span>PLAN C</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between">
                      <span>College Dispersal Corridor</span>
                      <b className="text-police dark:text-blue-400">04:15 PM</b>
                    </div>
                    <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between">
                      <span>Khairatabad Mandap</span>
                      <b className="text-police dark:text-blue-400">05:15 PM</b>
                    </div>
                    <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between">
                      <span>Panjagutta Wine Shop</span>
                      <b className="text-police dark:text-blue-400">06:15 PM</b>
                    </div>
                  </div>
                </div>

                <div className="glass-card p-3">
                  <div className="font-bold text-xs bg-police text-white p-2 rounded-t -m-3 mb-2 flex justify-between">
                    <span>SHIFT 3 (22:00 - 06:00)</span>
                    <span>PLAN D</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between">
                      <span>Panjagutta Wine Shop Closing</span>
                      <b className="text-police dark:text-blue-400">10:15 PM</b>
                    </div>
                    <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between">
                      <span>Abids Jewelry Corridor</span>
                      <b className="text-police dark:text-blue-400">01:30 AM</b>
                    </div>
                    <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between">
                      <span>Abids Circle State Bank ATM</span>
                      <b className="text-police dark:text-blue-400">03:00 AM</b>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==============================================================
              VIEW 4: PB MATRIX (PLAN A-D)
              ============================================================== */}
          {activeTab === "pb-matrix" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-extrabold text-police dark:text-blue-400">Point Book Route Plan Matrix</h2>
                  <p className="text-xs text-slate-500">Expand nested rows to view and edit Shift 1/2/3 timings for Plan A, B, C, D</p>
                </div>
              </div>

              <div className="glass-card p-4 overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 text-slate-600">
                      <th className="p-2.5">PB Code</th>
                      <th className="p-2.5">Place Name</th>
                      <th className="p-2.5">Category</th>
                      <th className="p-2.5">Sector</th>
                      <th className="p-2.5">Police Station</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Plans</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(pointBooks || []).map(pb => (
                      <React.Fragment key={pb.id}>
                        <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="p-2.5 font-bold text-police dark:text-blue-400">{pb.pb_code}</td>
                          <td className="p-2.5"><b>{pb.name}</b></td>
                          <td className="p-2.5">{pb.category}</td>
                          <td className="p-2.5">{pb.sector}</td>
                          <td className="p-2.5">{pb.station}</td>
                          <td className="p-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${pb.visit_status === 'Visited' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                              {pb.visit_status}
                            </span>
                          </td>
                          <td className="p-2.5">
                            <button onClick={() => setExpandedPBs({ ...expandedPBs, [pb.id]: !expandedPBs[pb.id] })} className="text-police-pink font-bold hover:underline">
                              {expandedPBs[pb.id] ? "▼ Hide Plans" : "▶ View Plans A-D"}
                            </button>
                          </td>
                        </tr>

                        {expandedPBs[pb.id] && (
                          <tr>
                            <td colSpan="7" className="p-3 bg-slate-50 dark:bg-slate-850">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {["PLAN A", "PLAN B", "PLAN C", "PLAN D"].map(planCode => (
                                  <div key={planCode} className="border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 overflow-hidden">
                                    <div className="bg-police-pink text-white text-center font-bold text-[11px] py-1">{planCode}</div>
                                    <div className="p-2 space-y-1 text-[11px]">
                                      <div className="flex justify-between"><span>Shift 1:</span> <b>{pb.plans?.[planCode]?.["1"] || "08:30 AM"}</b></div>
                                      <div className="flex justify-between"><span>Shift 2:</span> <b>{pb.plans?.[planCode]?.["2"] || "04:15 PM"}</b></div>
                                      <div className="flex justify-between"><span>Shift 3:</span> <b>{pb.plans?.[planCode]?.["3"] || "11:00 PM"}</b></div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==============================================================
              VIEW 5: DIAL 100 EMERGENCY DIVERSION FLOWCHART
              ============================================================== */}
          {activeTab === "dial100" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-police dark:text-blue-400">Dial 100 Emergency Route Diversion State Machine</h2>
                <p className="text-xs text-slate-500">Implements flowchart from PatrolManagement_dark.png</p>
              </div>

              {/* Flowchart Diagram */}
              <div className="glass-card p-6 bg-slate-900 text-white flex flex-col items-center gap-3">
                <div className="bg-purple-900 px-6 py-2 rounded font-bold text-xs border border-purple-400">Patrol Management</div>
                <div className="text-slate-400">↓</div>
                <div className="flex gap-4">
                  <div className="bg-blue-800 px-4 py-2 rounded text-xs">Beat Point Entry</div>
                  <div className="bg-amber-800 px-4 py-2 rounded text-xs">Beat point time selection &amp; Shift</div>
                  <div className="bg-amber-800 px-4 py-2 rounded text-xs">Shift Wise Beat of the Day</div>
                </div>
                <div className="text-slate-400">↓</div>
                <div className={`px-6 py-2 rounded font-bold text-xs border ${dispatchSession.state === 'ROUTE_DECIDE' ? 'bg-emerald-700 flow-step-active' : 'bg-emerald-900'}`}>
                  Route Decide (Normal Beat Patrol)
                </div>
                <div className="text-slate-400">↓</div>
                <div className="flex items-center gap-3">
                  <div className={`px-6 py-2 rounded font-bold text-xs border ${dispatchSession.state === 'ROUTE_DIVERSION' ? 'bg-rose-600 flow-step-active badge-pulse' : 'bg-blue-900'}`}>
                    Route Diversion (Nearest Unit)
                  </div>
                  <span className="text-xs text-slate-400">←</span>
                  <div className="bg-blue-600 px-3 py-1.5 rounded text-xs font-bold">Dial 100 Call 🚨</div>
                </div>
                <div className="text-slate-400">↓</div>
                <div className={`px-6 py-2 rounded font-bold text-xs border ${dispatchSession.state === 'POINTS_BALANCE' ? 'bg-emerald-700 flow-step-active' : 'bg-blue-900'}`}>
                  Complete Call
                </div>
                <div className="text-slate-400">↓</div>
                <div className="bg-amber-900 border border-amber-500 px-6 py-2 rounded font-bold text-xs">
                  Show Points Balance: Close the Call / Continue (or) Close the Day
                </div>
              </div>

              {/* Interactive Step Controls */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button onClick={() => handleTriggerDial100("Murder", "P1")} className="bg-rose-600 hover:bg-rose-700 text-white p-3 rounded-lg text-xs font-bold shadow">
                  1️⃣ Trigger Dial 100 Call &amp; Divert Patrol
                </button>
                <button onClick={handleCompleteCall} className="bg-police hover:bg-police-dark text-white p-3 rounded-lg text-xs font-bold shadow">
                  2️⃣ Complete Call &amp; Calculate Points Balance
                </button>
                <div className="flex gap-2">
                  <button onClick={() => handleDispatchDecision("continue")} className="bg-emerald-600 hover:bg-emerald-700 text-white p-3 rounded-lg text-xs font-bold flex-1 shadow">
                    3A. Continue Beat
                  </button>
                  <button onClick={() => handleDispatchDecision("close_day")} className="bg-amber-600 hover:bg-amber-700 text-white p-3 rounded-lg text-xs font-bold flex-1 shadow">
                    3B. Close Day
                  </button>
                </div>
              </div>

              {dispatchSession.points_balance && (
                <div className="glass-card p-4 border-l-4 border-emerald-500">
                  <h4 className="font-bold text-sm text-emerald-700 dark:text-emerald-400 mb-1">Points Balance Summary</h4>
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    Visited: <b>{dispatchSession.points_balance.visited_count}</b> | Remaining to Patrol: <b>{dispatchSession.points_balance.remaining_count}</b> of {dispatchSession.points_balance.total_points} Points
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==============================================================
              VIEW 6: FIELD CONSTABLE MOBILE APP SIMULATOR
              ============================================================== */}
          {activeTab === "mobile-sim" && (
            <div className="flex justify-center items-start py-2">
              <div className="phone-bezel flex flex-col">
                <div className="bg-police text-white p-3 flex justify-between items-center text-xs font-bold">
                  <span>☰</span>
                  <span>Patrol Management</span>
                  <span>🔔</span>
                </div>

                <div className="grid grid-cols-3 text-center bg-white border-b text-[11px] font-bold">
                  <button onClick={() => setMobileTab("visiting")} className={`py-2 ${mobileTab === 'visiting' ? 'border-b-2 border-police-pink text-police' : 'text-slate-500'}`}>Visiting</button>
                  <button onClick={() => setMobileTab("incidents")} className={`py-2 ${mobileTab === 'incidents' ? 'border-b-2 border-police-pink text-police' : 'text-slate-500'}`}>Incidents</button>
                  <button onClick={() => setMobileTab("myreport")} className={`py-2 ${mobileTab === 'myreport' ? 'border-b-2 border-police-pink text-police' : 'text-slate-500'}`}>My Report</button>
                </div>

                <div className="grid grid-cols-4 bg-slate-100 text-[10px] p-1.5 text-center border-b">
                  <div><b>District</b> HYD</div>
                  <div><b>Zone</b> EZ</div>
                  <div><b>PS</b> ABIDS</div>
                  <div><b>Veh</b> BC3</div>
                </div>

                <div className="flex-1 p-3 overflow-y-auto space-y-2.5 text-xs">
                  {mobileTab === "visiting" && !selectedVisitPB && (
                    <>
                      <div className="font-bold text-slate-700 text-[11px]">Assigned Beat Points Today (Plan A):</div>
                      <div className="space-y-1.5">
                        {pointBooks.slice(0, 5).map(pb => (
                          <div 
                            key={pb.id} 
                            onClick={() => setSelectedVisitPB(pb)}
                            className="p-2 border rounded-lg hover:border-police cursor-pointer bg-slate-50 flex justify-between items-center shadow-sm"
                          >
                            <div>
                              <div className="font-bold text-police">{pb.pb_code}</div>
                              <div className="text-[10px] text-slate-500">{pb.name}</div>
                            </div>
                            <span className="text-[10px] bg-police text-white px-2 py-0.5 rounded font-bold">CHECK-IN →</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Point Book Check-In Modal with 30m Geofence Slider & Voice */}
                  {selectedVisitPB && (
                    <div className="space-y-2.5">
                      <div className="bg-police text-white p-2 rounded text-center font-bold text-xs">POINTBOOK VISITING</div>
                      <div className="text-xs space-y-1">
                        <div><b>ID:</b> {selectedVisitPB.pb_code}</div>
                        <div><b>Name:</b> {selectedVisitPB.name}</div>
                        <div><b>Scheduled Time:</b> 10:30 AM</div>
                        <div><b>Deviation in Time:</b> <span className="text-police-pink font-bold">00:02:30 HRS</span></div>
                      </div>

                      {/* 30-Meter Geofence Slider */}
                      <div className="bg-slate-50 p-2 rounded border text-[11px]">
                        <div className="flex justify-between font-bold mb-1">
                          <span>GPS Distance: {visitDistance}m</span>
                          <span className={visitDistance <= 30 ? "text-emerald-600 font-bold" : "text-amber-600 font-bold"}>
                            {visitDistance <= 30 ? "✔ Within 30m" : "⚠ Outside 30m"}
                          </span>
                        </div>
                        <input 
                          type="range" 
                          min="5" 
                          max="80" 
                          value={visitDistance} 
                          onChange={e => setVisitDistance(Number(e.target.value))}
                          className="w-full"
                        />
                      </div>

                      {/* Native Speech/Text Input with Live Microphone & Google Translator */}
                      <div className="space-y-2 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        
                        {/* Header + Language Selector Tabs */}
                        <div className="flex justify-between items-center">
                          <label className="text-[11px] font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                            <span>Field Remarks</span>
                            <span className="text-[9px] font-normal text-slate-500">(Speech / Text)</span>
                          </label>

                          {/* Language Selector Pills */}
                          <div className="flex bg-slate-200 dark:bg-slate-700 p-0.5 rounded text-[10px] font-semibold">
                            <button
                              type="button"
                              onClick={() => setSpeechLang("te-IN")}
                              className={`px-1.5 py-0.5 rounded transition ${speechLang === 'te-IN' ? 'bg-police text-white shadow-xs' : 'text-slate-600 dark:text-slate-300'}`}
                            >
                              తెలుగు
                            </button>
                            <button
                              type="button"
                              onClick={() => setSpeechLang("hi-IN")}
                              className={`px-1.5 py-0.5 rounded transition ${speechLang === 'hi-IN' ? 'bg-police text-white shadow-xs' : 'text-slate-600 dark:text-slate-300'}`}
                            >
                              हिंदी
                            </button>
                            <button
                              type="button"
                              onClick={() => setSpeechLang("en-IN")}
                              className={`px-1.5 py-0.5 rounded transition ${speechLang === 'en-IN' ? 'bg-police text-white shadow-xs' : 'text-slate-600 dark:text-slate-300'}`}
                            >
                              EN
                            </button>
                          </div>
                        </div>

                        {/* Interactive Microphone Button (Speech to Text) */}
                        <div className="flex gap-1.5 items-center">
                          <button
                            type="button"
                            onClick={toggleListening}
                            className={`flex-1 py-1.5 px-2 rounded-md font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition ${
                              isListening 
                                ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse' 
                                : 'bg-rose-500 hover:bg-rose-600 text-white'
                            }`}
                          >
                            <span className="text-sm">{isListening ? '🔴' : '🎤'}</span>
                            <span>{isListening ? 'Listening... Tap to Stop' : `Record Voice (${speechLang === 'te-IN' ? 'Telugu' : speechLang === 'hi-IN' ? 'Hindi' : 'English'})`}</span>
                            {isListening && (
                              <span className="flex items-center gap-0.5 ml-1">
                                <span className="w-1 h-3 bg-white rounded-full animate-bounce"></span>
                                <span className="w-1 h-4 bg-white rounded-full animate-bounce [animation-delay:0.1s]"></span>
                                <span className="w-1 h-2 bg-white rounded-full animate-bounce [animation-delay:0.2s]"></span>
                              </span>
                            )}
                          </button>

                          {visitRemarks && (
                            <button
                              type="button"
                              onClick={() => { setVisitRemarks(""); setTranslatedText(""); }}
                              className="px-2 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-[10px] font-bold hover:bg-slate-300"
                              title="Clear Text"
                            >
                              ✕ Clear
                            </button>
                          )}
                        </div>

                        {/* Quick Voice Simulator Chips for instant demo testing */}
                        <div>
                          <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1 flex items-center justify-between">
                            <span>⚡ Quick Voice Chips (1-Click Test):</span>
                            <span className="text-[9px] text-police-pink font-bold">STT Demo</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              onClick={() => handleSelectVoiceSample("కళాశాల గేటు వద్ద అనుమానాస్పద వ్యక్తులు ఉన్నారు", "te-IN")}
                              className="text-[9.5px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-police hover:text-police px-1.5 py-0.5 rounded shadow-2xs text-left"
                            >
                              🇮🇳 Telugu: కళాశాల వద్ద అనుమానాస్పద (Alert)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectVoiceSample("ఏటీఎం వద్ద భద్రత పరిశీలించాము, అంతా ప్రశాంతంగా ఉంది", "te-IN")}
                              className="text-[9.5px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-police hover:text-police px-1.5 py-0.5 rounded shadow-2xs text-left"
                            >
                              🇮🇳 Telugu: ఏటీఎం వద్ద సాధారణం (Normal)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectVoiceSample("कॉलेज गेट के पास संदिग्ध व्यक्ति घूम रहे हैं, अतिरिक्त गश्त चाहिए", "hi-IN")}
                              className="text-[9.5px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-police hover:text-police px-1.5 py-0.5 rounded shadow-2xs text-left"
                            >
                              🇮🇳 Hindi: कॉलेज गेट संदिग्ध (Alert)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectVoiceSample("बैंक और मुख्य बाजार में स्थिति सामान्य है", "hi-IN")}
                              className="text-[9.5px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-police hover:text-police px-1.5 py-0.5 rounded shadow-2xs text-left"
                            >
                              🇮🇳 Hindi: मुख्य बाजार सामान्य (Normal)
                            </button>
                          </div>
                        </div>

                        {/* Speech Input Textarea */}
                        <div>
                          <textarea 
                            value={visitRemarks} 
                            onChange={e => {
                              setVisitRemarks(e.target.value);
                            }}
                            onBlur={() => {
                              if (visitRemarks.trim()) triggerGoogleTranslation(visitRemarks, speechLang);
                            }}
                            placeholder={isListening ? "Listening to your voice... Speak in Telugu / Hindi / English..." : "Spoken voice or typed native remarks will appear here..."}
                            className="w-full p-2 text-xs border rounded-md h-16 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-police"
                          />
                          <div className="flex justify-between items-center mt-0.5 text-[9.5px] text-slate-400">
                            <span>Chars: {visitRemarks.length}</span>
                            <button
                              type="button"
                              onClick={() => triggerGoogleTranslation(visitRemarks, speechLang)}
                              disabled={!visitRemarks.trim() || isTranslating}
                              className="text-police hover:underline font-bold flex items-center gap-1 disabled:opacity-40"
                            >
                              <span>🌐 Re-Translate with Google</span>
                            </button>
                          </div>
                        </div>

                        {/* Google Language Translator Output Card */}
                        {(translatedText || isTranslating) && (
                          <div className="p-2 rounded-md bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-[11px] space-y-1">
                            <div className="flex justify-between items-center text-[10px]">
                              <span className="font-extrabold text-blue-900 dark:text-blue-300 flex items-center gap-1">
                                <span>🌐 Google Language Translator</span>
                                {isTranslating && <span className="animate-spin text-xs">⟳</span>}
                              </span>
                              <span className="text-[9px] bg-blue-200/70 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-1 py-0.2 rounded font-semibold">
                                {detectedLangName || (speechLang === 'te-IN' ? 'Telugu' : 'Hindi')} → English
                              </span>
                            </div>

                            {isTranslating ? (
                              <div className="text-slate-500 italic text-[10px]">Translating with Google Translation API...</div>
                            ) : (
                              <div className="text-slate-800 dark:text-slate-200 font-medium">
                                "{translatedText}"
                              </div>
                            )}

                            <div className="flex items-center justify-between pt-1 border-t border-blue-100 dark:border-blue-900 text-[9.5px]">
                              <span className={visitSensitive ? "text-rose-600 font-bold" : "text-emerald-700 dark:text-emerald-400 font-bold"}>
                                {visitSensitive ? "🚨 High Urgency Flag (Sensitive Incident)" : "✔ Routine Beat Verification"}
                              </span>
                              <span className="text-slate-400">{translationProvider || "Google Translator Engine"}</span>
                            </div>
                          </div>
                        )}

                        {/* Sensitive Flag Toggle */}
                        <div className="flex items-center gap-2 pt-1">
                          <input 
                            type="checkbox" 
                            id="mobileSensitiveFlag"
                            checked={visitSensitive} 
                            onChange={e => setVisitSensitive(e.target.checked)}
                            className="rounded text-police focus:ring-police cursor-pointer"
                          />
                          <label htmlFor="mobileSensitiveFlag" className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                            Flag as Sensitive / Suspicious Incident (Alert SHO)
                          </label>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button onClick={() => setSelectedVisitPB(null)} className="w-1/2 bg-slate-300 py-1.5 rounded font-bold text-xs">CANCEL</button>
                        <button onClick={handleMobileSubmitVisit} className="w-1/2 bg-police text-white py-1.5 rounded font-bold text-xs">SUBMIT</button>
                      </div>
                    </div>
                  )}

                  {mobileTab === "myreport" && (
                    <div className="space-y-1.5">
                      <div className="font-bold text-slate-700 text-[11px]">Recent Visited Log:</div>
                      <div className="p-2 bg-slate-50 border rounded text-[11px]">
                        <div className="font-bold">PBA226471 • Andhra Bank ATM</div>
                        <div className="text-slate-500">Deviation: 00:02:30 HRS | Distance: 14m</div>
                        <div className="text-police font-medium mt-1">"ATM premises checked; security guard on post, situation verified normal."</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ==============================================================
              VIEW 7: INCIDENTS & SLA CONSOLE
              ============================================================== */}
          {activeTab === "incidents" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-police dark:text-blue-400">Incident Management &amp; SLA Console</h2>
                <p className="text-xs text-slate-500">Murder P1 (0-10 min), Robbery P1/P2 (15 min), College Alert P2 (20 min)</p>
              </div>

              <div className="glass-card p-4 overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 text-slate-600 border-b">
                      <th className="p-2.5">Code</th>
                      <th className="p-2.5">Type</th>
                      <th className="p-2.5">Priority</th>
                      <th className="p-2.5">Location</th>
                      <th className="p-2.5">Assigned Unit</th>
                      <th className="p-2.5">SLA Window</th>
                      <th className="p-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(incidents || []).map(inc => (
                      <tr key={inc.id}>
                        <td className="p-2.5 font-bold">{inc.incident_code}</td>
                        <td className="p-2.5">{inc.incident_type}</td>
                        <td className="p-2.5"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${inc.priority === 'P1' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{inc.priority}</span></td>
                        <td className="p-2.5">{inc.location_name}</td>
                        <td className="p-2.5 font-semibold text-police dark:text-blue-400">{inc.assigned_vehicle || "Pending"}</td>
                        <td className="p-2.5 font-bold text-rose-600">{inc.sla_minutes} mins</td>
                        <td className="p-2.5"><span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold text-[10px]">{inc.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Google Maps API Key & Tile Settings Modal */}
          {showMapModal && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl shadow-2xl p-5 max-w-md w-full border border-slate-200 dark:border-slate-700 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-700 pb-2">
                  <h3 className="font-bold text-sm text-police dark:text-blue-400 flex items-center gap-2">
                    🗺️ Google Maps API Key &amp; Tile Settings
                  </h3>
                  <button onClick={() => setShowMapModal(false)} className="text-slate-400 hover:text-slate-600 font-bold text-sm">✕</button>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="font-bold block mb-1">Google Maps API Key</label>
                    <input 
                      type="text" 
                      value={keyInput} 
                      onChange={e => setKeyInput(e.target.value)}
                      placeholder="Paste your AIzaSy... Google Maps API key" 
                      className="w-full p-2 border rounded border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white font-mono text-[11px]"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Your key is securely saved and attached directly to Google Maps requests (removes tile watermarks).
                    </p>
                  </div>

                  <div>
                    <label className="font-bold block mb-1.5">Map Layer Type</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'google-roadmap', label: '🚗 Google Roadmap' },
                        { id: 'google-satellite', label: '🛰️ Google Satellite' },
                        { id: 'google-hybrid', label: '🌐 Google Hybrid' },
                        { id: 'google-terrain', label: '⛰️ Google Terrain' },
                        { id: 'osm', label: '🗺️ OpenStreetMap (Free)' },
                      ].map(item => (
                        <label key={item.id} className={`flex items-center gap-1.5 p-2 rounded border cursor-pointer ${mapProvider === item.id ? 'border-police bg-blue-50/50 dark:bg-slate-750 font-bold text-police dark:text-blue-400' : 'border-slate-200 dark:border-slate-700'}`}>
                          <input 
                            type="radio" 
                            name="map_provider" 
                            value={item.id} 
                            checked={mapProvider === item.id} 
                            onChange={() => setMapProvider(item.id)}
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <button 
                    onClick={() => setShowMapModal(false)}
                    className="px-3 py-1.5 rounded bg-slate-200 dark:bg-slate-700 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={async () => {
                      const trimmed = keyInput.trim();
                      setGoogleMapsKey(trimmed);
                      localStorage.setItem("TSCOP_GOOGLE_MAPS_KEY", trimmed);
                      localStorage.setItem("TSCOP_MAP_PROVIDER", mapProvider);
                      try {
                        await fetch('/api/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ google_maps_api_key: trimmed, map_provider: mapProvider })
                        });
                      } catch (_e) {}
                      setShowMapModal(false);
                      showToast(`Google Maps layer updated to ${mapProvider.toUpperCase()}!`, "success");
                    }}
                    className="px-4 py-1.5 rounded bg-police-pink hover:bg-pink-700 text-white text-xs font-bold shadow"
                  >
                    Save &amp; Apply
                  </button>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
