"""
Geospatial calculation engine for TSCOP / SafeOS Patrol Management.
Handles Haversine distance, 30-meter Point Book geofence verification,
nearest patrol dispatch matching, and Area/Crime-oriented beat route planning.
"""

import math
from typing import Any, Dict, List, Optional


EARTH_RADIUS_M = 6371000.0
DEFAULT_GEOFENCE_RADIUS_M = 30.0


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute great-circle distance in meters between two WGS84 coordinates."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lon2 - lon1)

    a = (
        math.sin(d_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return round(EARTH_RADIUS_M * c, 2)


def check_geofence(
    officer_lat: float,
    officer_lon: float,
    target_lat: float,
    target_lon: float,
    radius_m: float = DEFAULT_GEOFENCE_RADIUS_M,
) -> Dict[str, Any]:
    """Verify if patrol unit GPS coordinate lies within the 30-meter PB perimeter."""
    dist_m = haversine_meters(officer_lat, officer_lon, target_lat, target_lon)
    return {
        "distance_meters": dist_m,
        "radius_meters": radius_m,
        "within_geofence": dist_m <= radius_m,
        "status_label": "VERIFIED (<= 30m)" if dist_m <= radius_m else f"OUTSIDE PERIMETER (+{round(dist_m - radius_m, 1)}m)",
    }


def find_nearest_vehicle(
    target_lat: float,
    target_lon: float,
    vehicles: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Find the closest patrol vehicle, prioritizing Available and On Patrol units."""
    if not vehicles:
        return None

    eligible = [v for v in vehicles if v.get("status") in ("Available", "On Patrol")]
    pool = eligible if eligible else vehicles

    best: Optional[Dict[str, Any]] = None
    best_dist = float("inf")

    for v in pool:
        v_lat = float(v.get("latitude") or 0.0)
        v_lon = float(v.get("longitude") or 0.0)
        if v_lat == 0.0 and v_lon == 0.0:
            continue
        dist_m = haversine_meters(target_lat, target_lon, v_lat, v_lon)
        if dist_m < best_dist:
            best_dist = dist_m
            best = dict(v)

    if best is None:
        return None

    dist_km = round(best_dist / 1000.0, 2)
    # Urban emergency response estimate (~36 km/h avg = 600 m/min)
    eta_min = max(1, round(best_dist / 600.0))
    best["distance_meters"] = best_dist
    best["distance_km"] = dist_km
    best["eta_minutes"] = eta_min
    return best


def _category_risk_weight(pb: Dict[str, Any]) -> int:
    cat = (pb.get("category") or "").lower()
    pb_type = (pb.get("pb_type") or "").lower()
    score = 0
    if pb.get("is_sensitive"):
        score += 50
    if "hotspot" in cat or "wine" in cat or "bar" in cat:
        score += 40
    elif "atm" in cat or "bank" in cat or "jewelry" in cat:
        score += 30
    elif "college" in cat or "school" in cat:
        score += 25
    elif "pandal" in pb_type or "mandap" in pb_type or "picket" in pb_type:
        score += 20
    return score


def optimize_beat_route(
    point_books: List[Dict[str, Any]],
    method: str = "Area Oriented",
) -> Dict[str, Any]:
    """
    Order Point Books for a beat patrol route using either:
    - Area Oriented: spatial nearest-neighbor shortest loop
    - Crime Oriented: prioritizes high-risk / sensitive / hotspot points first, then spatial proximity
    """
    if not point_books:
        return {
            "method": method,
            "total_distance_km": 0.0,
            "ordered_points": [],
            "planned_polyline": [],
            "actual_polyline": [],
        }

    remaining = [dict(p) for p in point_books]
    if method.lower().startswith("crime"):
        remaining.sort(key=lambda p: (-_category_risk_weight(p), p.get("pb_code", "")))
        current = remaining.pop(0)
    else:
        remaining.sort(key=lambda p: p.get("pb_code", ""))
        current = remaining.pop(0)

    ordered: List[Dict[str, Any]] = [current]
    total_m = 0.0

    while remaining:
        c_lat, c_lon = float(current["latitude"]), float(current["longitude"])
        if method.lower().startswith("crime"):
            # Weighted score: distance penalty minus risk priority
            next_idx = min(
                range(len(remaining)),
                key=lambda i: haversine_meters(
                    c_lat, c_lon, float(remaining[i]["latitude"]), float(remaining[i]["longitude"])
                )
                - (_category_risk_weight(remaining[i]) * 25.0),
            )
        else:
            next_idx = min(
                range(len(remaining)),
                key=lambda i: haversine_meters(
                    c_lat, c_lon, float(remaining[i]["latitude"]), float(remaining[i]["longitude"])
                ),
            )
        nxt = remaining.pop(next_idx)
        seg_m = haversine_meters(c_lat, c_lon, float(nxt["latitude"]), float(nxt["longitude"]))
        total_m += seg_m
        nxt["leg_distance_km"] = round(seg_m / 1000.0, 2)
        ordered.append(nxt)
        current = nxt

    ordered[0]["leg_distance_km"] = 0.0
    planned_polyline = [[float(p["latitude"]), float(p["longitude"])] for p in ordered]

    # Simulated actual patrol track (slight road curvature + minor detour near midpoint)
    actual_polyline: List[List[float]] = []
    for idx, pt in enumerate(planned_polyline):
        offset_lat = 0.00055 * math.sin(idx * 1.4)
        offset_lon = 0.00065 * math.cos(idx * 1.1)
        actual_polyline.append([round(pt[0] + offset_lat, 6), round(pt[1] + offset_lon, 6)])
        if idx == len(planned_polyline) // 2 and len(planned_polyline) >= 3:
            # Minor simulated diversion spur matching slide 6 comparison
            actual_polyline.append([round(pt[0] + 0.0021, 6), round(pt[1] + 0.0024, 6)])
            actual_polyline.append([round(pt[0] + 0.0004, 6), round(pt[1] + 0.0007, 6)])

    return {
        "method": method,
        "total_distance_km": round(total_m / 1000.0, 2),
        "ordered_points": ordered,
        "planned_polyline": planned_polyline,
        "actual_polyline": actual_polyline,
    }
