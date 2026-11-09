/**
 * ============================================================================
 * Geospatial Engine & 30-Meter Geofencing Service
 * Implements Haversine distance, perimeter validation, nearest vehicle dispatch,
 * and Area-Oriented vs Crime-Oriented route planning.
 * ============================================================================
 */

const EARTH_RADIUS_M = 6371000.0;
const GEOFENCE_RADIUS_M = 30.0;

function toRad(degrees) {
  return (degrees * Math.PI) / 180.0;
}

/**
 * Calculates great-circle distance between two GPS coordinates in meters using Haversine formula.
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_M * c * 100) / 100;
}

/**
 * Verifies if an officer coordinate is strictly within the 30-meter Point Book perimeter.
 */
function check30mGeofence(officerLat, officerLon, targetLat, targetLon, radiusM = GEOFENCE_RADIUS_M) {
  const dist = haversineMeters(officerLat, officerLon, targetLat, targetLon);
  return {
    distance_meters: dist,
    radius_meters: radiusM,
    within_geofence: dist <= radiusM,
    status_label: dist <= radiusM ? "VERIFIED (<= 30m)" : `OUTSIDE PERIMETER (+${Math.round(dist - radiusM)}m)`,
  };
}

/**
 * Locates the nearest available or on-patrol vehicle to an emergency incident.
 */
function findNearestVehicle(targetLat, targetLon, vehicles) {
  if (!vehicles || vehicles.length === 0) return null;
  const eligible = vehicles.filter(v => v.status === "Available" || v.status === "On Patrol");
  const pool = eligible.length > 0 ? eligible : vehicles;

  let best = null;
  let minDistance = Infinity;

  pool.forEach(v => {
    const dist = haversineMeters(targetLat, targetLon, v.latitude, v.longitude);
    if (dist < minDistance) {
      minDistance = dist;
      best = v;
    }
  });

  if (!best) return null;

  const distKm = Math.round((minDistance / 1000.0) * 100) / 100;
  // Estimated emergency response time assuming 36 km/h = 600 m/min in Hyderabad city traffic
  const etaMinutes = Math.max(1, Math.round(minDistance / 600.0));

  return {
    ...best,
    distance_meters: minDistance,
    distance_km: distKm,
    eta_minutes: etaMinutes,
  };
}

/**
 * Generates an optimized beat route sequence based on:
 * - "Area Oriented": Shortest physical Euclidean loop
 * - "Crime Oriented": Prioritizes high-risk, sensitive, and last-month incident hotspots first
 */
function optimizeBeatRoute(pointBooks, method = "Area Oriented") {
  if (!pointBooks || pointBooks.length === 0) {
    return { method, total_distance_km: 0, ordered_points: [], planned_polyline: [], actual_polyline: [] };
  }

  const remaining = [...pointBooks];
  // Sort initial point
  if (method === "Crime Oriented") {
    remaining.sort((a, b) => (b.is_sensitive ? 1 : 0) - (a.is_sensitive ? 1 : 0));
  }
  const ordered = [remaining.shift()];
  let totalMeters = 0;

  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1];
    let nextIdx = 0;
    let bestScore = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const dist = haversineMeters(current.latitude, current.longitude, candidate.latitude, candidate.longitude);
      const score = method === "Crime Oriented" ? dist - (candidate.is_sensitive ? 1500 : 0) : dist;
      if (score < bestScore) {
        bestScore = score;
        nextIdx = i;
      }
    }

    const nxt = remaining.splice(nextIdx, 1)[0];
    const legDist = haversineMeters(current.latitude, current.longitude, nxt.latitude, nxt.longitude);
    totalMeters += legDist;
    nxt.leg_distance_km = Math.round((legDist / 1000.0) * 100) / 100;
    ordered.push(nxt);
  }

  ordered[0].leg_distance_km = 0;
  const plannedPolyline = ordered.map(p => [p.latitude, p.longitude]);

  // Generate simulated realistic actual GPS route with slight road curve deviation
  const actualPolyline = plannedPolyline.map((pt, idx) => {
    const jitterLat = 0.00045 * Math.sin(idx * 1.5);
    const jitterLon = 0.00055 * Math.cos(idx * 1.2);
    return [Number((pt[0] + jitterLat).toFixed(6)), Number((pt[1] + jitterLon).toFixed(6))];
  });

  return {
    method,
    total_distance_km: Math.round((totalMeters / 1000.0) * 100) / 100,
    ordered_points: ordered,
    planned_polyline: plannedPolyline,
    actual_polyline: actualPolyline,
  };
}

module.exports = {
  haversineMeters,
  check30mGeofence,
  findNearestVehicle,
  optimizeBeatRoute,
};
