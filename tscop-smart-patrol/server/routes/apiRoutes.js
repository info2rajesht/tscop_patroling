/**
 * ============================================================================
 * REST API Router for TSCOP / Fusion safeOS Smart Patrol Management
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { getHistoricalRecommendations, applySHOOverride } = require('../services/historicalAnalytics');
const { check30mGeofence, findNearestVehicle, optimizeBeatRoute } = require('../services/geoService');
const { translateNativeToEnglish, translateWithGoogle } = require('../services/nlpTranslator');
const { toggleSimulation, isSimulationRunning } = require('../services/patrolSimulator');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function handleApiRequest(req, res, parsedUrl, body, broadcastEvent) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Set JSON headers
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Settings: Google Maps API Key & Map Provider
  if (method === 'GET' && pathname === '/api/settings') {
    const db = loadDB();
    res.writeHead(200);
    res.end(JSON.stringify({
      google_maps_api_key: db.settings?.google_maps_api_key || process.env.GOOGLE_MAPS_API_KEY || '',
      map_provider: db.settings?.map_provider || 'google-roadmap',
    }));
    return;
  }

  if (method === 'POST' && pathname === '/api/settings') {
    const db = loadDB();
    db.settings = db.settings || {};
    if (body.google_maps_api_key !== undefined) db.settings.google_maps_api_key = body.google_maps_api_key;
    if (body.map_provider !== undefined) db.settings.map_provider = body.map_provider;
    saveDB(db);
    broadcastEvent('settings:update', db.settings);
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'saved', settings: db.settings }));
    return;
  }

  // 1. Dashboard Endpoint
  if (method === 'GET' && pathname === '/api/dashboard') {
    const db = loadDB();
    const hist = getHistoricalRecommendations();
    const activeIncs = (db.incidents || []).filter(i => i.status !== 'Closed');

    res.writeHead(200);
    res.end(JSON.stringify({
      kpis: {
        total_vehicles: (db.vehicles || []).length,
        active_incidents: activeIncs.length,
        p1_incidents: activeIncs.filter(i => i.priority === 'P1').length,
        p2_incidents: activeIncs.filter(i => i.priority === 'P2').length,
        officers_on_duty: (db.officers || []).filter(o => o.status === 'Active').length,
        total_point_books: (db.pointBooks || []).length,
        visited_point_books: (db.pointBooks || []).filter(p => p.visit_status === 'Visited').length,
        high_risk_hotspots: hist.high_priority_count,
        sho_overrides_count: (db.shoOverrides || []).length,
      },
      vehicles: db.vehicles || [],
      recent_incidents: activeIncs.slice(0, 5),
      shifts: db.shifts || [],
      sho_overrides: db.shoOverrides || [],
    }));
    return;
  }

  // 2. Historical Intelligence & AI Beat Recommender (Based on Last Month Data)
  if (method === 'GET' && pathname === '/api/historical/recommendations') {
    const data = getHistoricalRecommendations();
    res.writeHead(200);
    res.end(JSON.stringify(data));
    return;
  }

  // 3. SHO Override Endpoint (SHO modifies AI suggested beat point or timing)
  if (method === 'POST' && pathname === '/api/historical/override') {
    try {
      const result = applySHOOverride(body);
      broadcastEvent('sho:override', result);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 4. Point Books List
  if (method === 'GET' && pathname === '/api/pointbooks') {
    const db = loadDB();
    res.writeHead(200);
    res.end(JSON.stringify({ point_books: db.pointBooks || [] }));
    return;
  }

  // 5. Register New Point Book
  if (method === 'POST' && pathname === '/api/pointbooks') {
    const db = loadDB();
    const count = (db.pointBooks || []).length;
    const newPB = {
      id: count + 1,
      pb_code: body.pb_code || `PB${25000 + count + 1}`,
      name: body.name,
      category: body.category || 'ATM',
      pb_type: body.pb_type || 'Security Guard',
      sector: body.sector || 'Sector-1',
      station: body.station || 'Abids PS',
      zone: 'EZ',
      district: 'HYDERABAD',
      holder_name: body.holder_name || 'Guard',
      holder_mobile: body.holder_mobile || '9848011223',
      latitude: Number(body.latitude) || 17.3948,
      longitude: Number(body.longitude) || 78.4742,
      address: body.address || 'Hyderabad',
      description: body.description || '',
      is_sensitive: Boolean(body.is_sensitive),
      visit_status: 'Non Visited',
      plans: {
        "PLAN A": { "1": "08:30 AM", "2": "03:30 PM", "3": "11:00 PM" },
        "PLAN B": { "1": "09:45 AM", "2": "05:00 PM", "3": "12:15 AM" },
        "PLAN C": { "1": "11:15 AM", "2": "06:30 PM", "3": "01:45 AM" },
        "PLAN D": { "1": "12:30 PM", "2": "08:15 PM", "3": "03:30 AM" }
      }
    };
    db.pointBooks.push(newPB);
    saveDB(db);
    broadcastEvent('data:refresh', { type: 'pointbook_created' });
    res.writeHead(200);
    res.end(JSON.stringify({ point_book: newPB }));
    return;
  }

  // 6. Update Point Book Plan A-D Timings
  if (method === 'PUT' && pathname.startsWith('/api/pointbooks/') && pathname.endsWith('/plans')) {
    const pbId = Number(pathname.split('/')[3]);
    const db = loadDB();
    const pb = db.pointBooks.find(p => p.id === pbId);
    if (!pb) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Point book not found' }));
      return;
    }
    (body.slots || []).forEach(slot => {
      pb.plans[slot.plan_code] = pb.plans[slot.plan_code] || {};
      pb.plans[slot.plan_code][String(slot.shift_id)] = slot.scheduled_time;
    });
    saveDB(db);
    broadcastEvent('data:refresh', { type: 'plans_updated' });
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'success', point_book: pb }));
    return;
  }

  // 7. Today Route Plan
  if (method === 'GET' && pathname === '/api/daily-routes') {
    const db = loadDB();
    res.writeHead(200);
    res.end(JSON.stringify({ assignments: db.dailyRouteAssignments || {} }));
    return;
  }

  if (method === 'POST' && pathname === '/api/daily-routes') {
    const db = loadDB();
    db.dailyRouteAssignments = body.assignments || db.dailyRouteAssignments;
    saveDB(db);
    broadcastEvent('data:refresh', { type: 'daily_routes_updated' });
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'saved' }));
    return;
  }

  // 8. Beat Planner Recommendation (Area vs Crime Oriented)
  if (method === 'POST' && pathname === '/api/beat-planner/recommend') {
    const db = loadDB();
    let pbs = db.pointBooks || [];
    if (body.station && body.station !== 'All') {
      pbs = pbs.filter(p => p.station.toLowerCase() === body.station.toLowerCase());
    }
    const result = optimizeBeatRoute(pbs.length > 0 ? pbs : db.pointBooks, body.method || 'Area Oriented');
    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  // 9. Point Book Mobile Check-In & Verification
  if (method === 'POST' && pathname === '/api/visits') {
    const db = loadDB();
    const pb = db.pointBooks.find(p => p.id === Number(body.pb_id));
    if (!pb) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Point book not found' }));
      return;
    }

    const distM = body.simulated_distance_m !== undefined ? Number(body.simulated_distance_m) : 15.0;
    const geofence = {
      distance_meters: distM,
      within_geofence: distM <= 30.0,
      status_label: distM <= 30.0 ? 'VERIFIED (<= 30m)' : `OUTSIDE PERIMETER (+${Math.round(distM - 30)}m)`
    };

    let translation;
    if (body.remarks_english) {
      translation = {
        original_text: body.remarks_text || '',
        detected_language: body.detected_language || 'Native Script',
        english_translation: body.remarks_english,
        urgency: body.is_sensitive ? 'High (Flagged Sensitive)' : 'Normal',
        provider: body.translation_provider || 'Google Language Translator',
      };
    } else {
      translation = await translateWithGoogle(
        body.remarks_text || '', 
        body.source_lang || 'auto', 
        'en', 
        db.settings?.google_maps_api_key
      );
    }

    const isSensitive = Boolean(body.is_sensitive || translation.urgency.startsWith('High'));

    pb.visit_status = isSensitive ? 'Sensitive' : 'Visited';
    pb.is_sensitive = isSensitive;
    pb.last_visited_at = new Date().toISOString();

    const visitRecord = {
      id: (db.visits || []).length + 1,
      pb_code: pb.pb_code,
      pb_name: pb.name,
      scheduled_time: pb.plans?.['PLAN A']?.['1'] || '10:30 AM',
      actual_time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      deviation_formatted: '00:02:30 HRS',
      distance_meters: distM,
      geofence_ok: geofence.within_geofence,
      remarks_native: translation.original_text,
      remarks_english: translation.english_translation,
      detected_language: translation.detected_language,
      provider: translation.provider,
      sensitive_flagged: isSensitive,
      visited_at: new Date().toISOString(),
    };

    db.visits = db.visits || [];
    db.visits.unshift(visitRecord);
    saveDB(db);

    broadcastEvent('visit:logged', { visit: visitRecord, geofence, translation });
    res.writeHead(200);
    res.end(JSON.stringify({ visit: visitRecord, geofence, translation, new_pb_status: pb.visit_status }));
    return;
  }

  // 10. Google Language Translator API
  if (method === 'POST' && pathname === '/api/translate/google') {
    const db = loadDB();
    const apiKey = db.settings?.google_maps_api_key || process.env.GOOGLE_MAPS_API_KEY || null;
    const { text = '', source_lang = 'auto', target_lang = 'en' } = body || {};
    try {
      const result = await translateWithGoogle(text, source_lang, target_lang, apiKey);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(200);
      res.end(JSON.stringify(translateNativeToEnglish(text)));
    }
    return;
  }

  // 11. Incidents
  if (method === 'GET' && pathname === '/api/incidents') {
    const db = loadDB();
    res.writeHead(200);
    res.end(JSON.stringify({ incidents: db.incidents || [] }));
    return;
  }

  if (method === 'POST' && pathname === '/api/incidents') {
    const db = loadDB();
    const nearest = findNearestVehicle(Number(body.latitude), Number(body.longitude), db.vehicles || []);
    const newInc = {
      id: (db.incidents || []).length + 1,
      incident_code: `INC${100 + (db.incidents || []).length + 1}`,
      incident_type: body.incident_type || 'General Alert',
      priority: body.priority || 'P2',
      sla_minutes: body.priority === 'P1' ? 10 : 20,
      station: body.station || 'Abids PS',
      location_name: body.location_name || 'Hyderabad Sector',
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      description: body.description || '',
      reported_time: new Date().toISOString(),
      status: nearest ? 'Assigned' : 'Open',
      assigned_vehicle: nearest ? nearest.vehicle_no : 'Pending',
      investigating_officer: 'SI Srinivas Rao',
    };
    db.incidents.unshift(newInc);
    if (nearest) {
      const v = db.vehicles.find(veh => veh.id === nearest.id);
      if (v) v.status = 'Responding';
    }
    saveDB(db);

    broadcastEvent('incident:alert', { incident: newInc, nearest_vehicle: nearest });
    res.writeHead(200);
    res.end(JSON.stringify({ incident: newInc, nearest_vehicle: nearest }));
    return;
  }

  if (method === 'PUT' && pathname.startsWith('/api/incidents/') && pathname.endsWith('/close')) {
    const incId = Number(pathname.split('/')[3]);
    const db = loadDB();
    const inc = db.incidents.find(i => i.id === incId);
    if (!inc) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Incident not found' }));
      return;
    }
    inc.status = 'Closed';
    inc.action_taken = body.action_taken || 'Settled';
    if (inc.assigned_vehicle) {
      const v = db.vehicles.find(veh => veh.vehicle_no === inc.assigned_vehicle);
      if (v && v.status === 'Responding') v.status = 'On Patrol';
    }
    saveDB(db);
    broadcastEvent('data:refresh', { type: 'incident_closed' });
    res.writeHead(200);
    res.end(JSON.stringify({ incident: inc }));
    return;
  }

  // 11. Dial 100 Emergency Diversion Flow
  if (method === 'POST' && pathname === '/api/dispatch/trigger') {
    const db = loadDB();
    const nearest = findNearestVehicle(17.3915, 78.4765, db.vehicles || []);
    const veh = db.vehicles.find(v => v.id === (nearest ? nearest.id : 2));
    if (veh) veh.status = 'Diverted';

    const dispatchSession = {
      state: 'ROUTE_DIVERSION',
      incident: {
        code: `D100-${Date.now().toString().slice(-4)}`,
        type: body.incident_type || 'Murder',
        priority: body.priority || 'P1',
        location: body.location_name || 'Tilak Road Commercial Lane, Abids',
      },
      diverted_vehicle: veh,
      points_balance: {
        total_points: (db.pointBooks || []).length,
        visited_count: (db.pointBooks || []).filter(p => p.visit_status === 'Visited').length,
        remaining_count: (db.pointBooks || []).filter(p => p.visit_status !== 'Visited').length,
      }
    };
    saveDB(db);
    broadcastEvent('dispatch:alert', dispatchSession);
    res.writeHead(200);
    res.end(JSON.stringify(dispatchSession));
    return;
  }

  if (method === 'POST' && pathname === '/api/dispatch/complete') {
    const db = loadDB();
    const bal = {
      state: 'POINTS_BALANCE',
      total_points: (db.pointBooks || []).length,
      visited_count: (db.pointBooks || []).filter(p => p.visit_status === 'Visited').length,
      remaining_count: (db.pointBooks || []).filter(p => p.visit_status !== 'Visited').length,
      remaining_points: (db.pointBooks || []).filter(p => p.visit_status !== 'Visited').slice(0, 5),
    };
    broadcastEvent('dispatch:update', bal);
    res.writeHead(200);
    res.end(JSON.stringify(bal));
    return;
  }

  if (method === 'POST' && pathname === '/api/dispatch/decision') {
    const db = loadDB();
    const decision = body.decision; // "continue" or "close_day"
    db.vehicles.forEach(v => {
      if (v.status === 'Diverted') v.status = decision === 'continue' ? 'On Patrol' : 'Available';
    });
    saveDB(db);
    const result = {
      state: decision === 'continue' ? 'CONTINUED_ROUTE' : 'DAY_CLOSED',
      message: decision === 'continue' ? 'Patrol unit resumed beat route for remaining Point Books.' : 'Shift day closed; remaining balance carried to next shift.'
    };
    broadcastEvent('dispatch:update', result);
    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  // 12. Translation Sandbox
  if (method === 'POST' && pathname === '/api/translate') {
    const resPayload = translateNativeToEnglish(body.text || '');
    res.writeHead(200);
    res.end(JSON.stringify(resPayload));
    return;
  }

  // 13. Simulator Toggle
  if (method === 'POST' && pathname === '/api/simulator/toggle') {
    const running = toggleSimulation();
    res.writeHead(200);
    res.end(JSON.stringify({ running }));
    return;
  }

  // Default 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: `Not found: ${method} ${pathname}` }));
}

module.exports = {
  handleApiRequest,
};
