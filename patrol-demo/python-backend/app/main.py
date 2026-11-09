"""
TSCOP / SafeOS Smart Patrol & Beat Management System
Python FastAPI Service (Port 8000):
- Spatial SQLite persistence & PostgreSQL/PostGIS schema compatibility
- Haversine 30-meter geofencing & nearest patrol vehicle dispatch
- Area-Oriented & Crime-Oriented Beat Route Optimization
- AI Blind Spot Detection, Crime Hotspots, SHO News Feed & Native-to-English Translator
"""

from contextlib import asynccontextmanager
import csv
from datetime import datetime, timezone
import io
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from .ai_service import generate_ai_insights, translate_native_to_english
from .db import DB_PATH, get_conn, seed_database
from .geo_service import check_geofence, find_nearest_vehicle, optimize_beat_route


@asynccontextmanager
async def lifespan(_app: FastAPI):
    seed_database(force_reset=False)
    yield


app = FastAPI(
    title="TSCOP / SafeOS Patrol AI & GIS Service",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------

class TelemetryUpdate(BaseModel):
    latitude: float
    longitude: float
    speed_kmh: Optional[float] = 25.0
    heading: Optional[int] = 90
    status: Optional[str] = None


class PointBookCreate(BaseModel):
    pb_code: Optional[str] = None
    name: str
    category: str
    pb_type: str
    sector: str
    station: str
    zone: str = "EZ"
    district: str = "HYDERABAD"
    holder_name: str
    holder_mobile: str
    latitude: float
    longitude: float
    address: str
    description: str = ""
    is_sensitive: bool = False


class PlanSlotUpdate(BaseModel):
    plan_code: str
    shift_id: int
    scheduled_time: str


class PointBookPlansUpdate(BaseModel):
    slots: List[PlanSlotUpdate]


class DailyRouteItem(BaseModel):
    station: str
    shift_id: int
    plan_code: str


class DailyRoutesSave(BaseModel):
    assigned_by: str = "SHO_ABIDS"
    assignments: List[DailyRouteItem]


class BeatPlannerRequest(BaseModel):
    station: str = "All"
    sector: str = "All"
    route_name: str = "Route 1"
    method: str = "Area Oriented"  # "Area Oriented" or "Crime Oriented"
    shift_id: int = 1


class VisitCreate(BaseModel):
    pb_id: int
    vehicle_id: int = 2
    officer_id: int = 5
    plan_code: str = "PLAN A"
    shift_id: int = 1
    officer_lat: Optional[float] = None
    officer_lon: Optional[float] = None
    simulated_distance_m: Optional[float] = None
    simulated_deviation_sec: Optional[int] = None
    remarks_text: str = ""
    is_sensitive: bool = False
    audio_simulated: bool = False


class IncidentCreate(BaseModel):
    incident_type: str
    priority: Optional[str] = None
    station: str = "Abids PS"
    location_name: str
    latitude: float
    longitude: float
    description: str = ""
    caller_phone: str = "Dial-100"
    auto_assign: bool = True


class IncidentClose(BaseModel):
    action_taken: str = "Settled"
    closure_comments: str = ""


class DispatchTrigger(BaseModel):
    incident_type: str = "Murder"
    priority: str = "P1"
    station: str = "Abids PS"
    location_name: str = "Tilak Road Commercial Junction, Abids"
    latitude: float = 17.3915
    longitude: float = 78.4765
    description: str = "Dial 100 emergency call requiring immediate nearest patrol route diversion."


class DispatchComplete(BaseModel):
    action_taken: str = "Settled"
    notes: str = "Emergency call handled and scene secured; ready for points balance check."


class DispatchDecision(BaseModel):
    decision: str = Field(..., pattern="^(continue|close_day)$")


class TranslateRequest(BaseModel):
    text: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SLA_MAP = {
    "Murder": ("P1", 10),
    "Kidnapping": ("P1", 10),
    "Armed Robbery": ("P1", 15),
    "Robbery": ("P2", 15),
    "College Security Alert": ("P2", 20),
    "Theft": ("P2", 30),
    "Missing Person": ("P2", 30),
    "Traffic Violation": ("P3", 60),
    "Public Nuisance": ("P3", 60),
}


def _rows_to_dicts(rows: List[Any]) -> List[Dict[str, Any]]:
    return [dict(r) for r in rows]


def _format_hms(total_seconds: int) -> str:
    secs = abs(int(total_seconds))
    h = secs // 3600
    m = (secs % 3600) // 60
    s = secs % 60
    return f"{h:02d}:{m:02d}:{s:02d} HRS"


def _parse_time_to_minutes(t_str: str) -> int:
    try:
        dt = datetime.strptime(t_str.strip().upper(), "%I:%M %p")
        return dt.hour * 60 + dt.minute
    except Exception:
        return 10 * 60 + 30


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> Dict[str, Any]:
    with get_conn() as conn:
        pb_count = conn.execute("SELECT COUNT(*) FROM point_books").fetchone()[0]
        veh_count = conn.execute("SELECT COUNT(*) FROM patrol_vehicles").fetchone()[0]
        inc_count = conn.execute("SELECT COUNT(*) FROM incidents").fetchone()[0]
    return {
        "status": "ok",
        "service": "python-ai-gis",
        "database": str(DB_PATH.name),
        "counts": {"point_books": pb_count, "vehicles": veh_count, "incidents": inc_count},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/reset-demo")
def reset_demo() -> Dict[str, Any]:
    seed_database(force_reset=True)
    return {"status": "reset_complete", "message": "Demo database restored to fresh initial state."}


@app.get("/api/dashboard")
def get_dashboard() -> Dict[str, Any]:
    with get_conn() as conn:
        vehicles = _rows_to_dicts(conn.execute("SELECT * FROM patrol_vehicles").fetchall())
        incidents = _rows_to_dicts(conn.execute("SELECT * FROM incidents ORDER BY id DESC").fetchall())
        officers = _rows_to_dicts(conn.execute("SELECT * FROM officers").fetchall())
        shifts = _rows_to_dicts(conn.execute("SELECT * FROM shifts ORDER BY id").fetchall())
        point_books = _rows_to_dicts(conn.execute("SELECT * FROM point_books").fetchall())
        colleges = _rows_to_dicts(conn.execute("SELECT * FROM colleges_hotspots").fetchall())
        visits = _rows_to_dicts(conn.execute("SELECT * FROM pb_visits ORDER BY id DESC").fetchall())

    active_incidents = [i for i in incidents if i["status"] not in ("Closed", "Settled")]
    p1_count = sum(1 for i in active_incidents if i["priority"] == "P1")
    p2_count = sum(1 for i in active_incidents if i["priority"] == "P2")
    p3_count = sum(1 for i in active_incidents if i["priority"] == "P3")

    ai = generate_ai_insights(point_books, incidents, colleges)

    # Shift manpower breakdown
    shift_manpower = []
    for sh in shifts:
        cnt = sum(1 for o in officers if o["shift_id"] == sh["id"] and o["status"] == "Active")
        veh_cnt = sum(1 for v in vehicles if v["shift_id"] == sh["id"])
        shift_manpower.append({
            "shift_code": sh["shift_code"],
            "shift_name": sh["shift_name"],
            "time_window": f"{sh['start_time']} - {sh['end_time']}",
            "officers": cnt,
            "vehicles": veh_cnt,
        })

    # Vehicle status breakdown
    veh_status_counts: Dict[str, int] = {}
    for v in vehicles:
        veh_status_counts[v["status"]] = veh_status_counts.get(v["status"], 0) + 1

    visited_pb = sum(1 for pb in point_books if pb["visit_status"] == "Visited")
    sensitive_pb = sum(1 for pb in point_books if pb["visit_status"] == "Sensitive" or pb["is_sensitive"])

    return {
        "kpis": {
            "total_vehicles": len(vehicles),
            "active_incidents": len(active_incidents),
            "p1_incidents": p1_count,
            "p2_incidents": p2_count,
            "p3_incidents": p3_count,
            "officers_on_duty": sum(1 for o in officers if o["status"] == "Active"),
            "total_point_books": len(point_books),
            "visited_point_books": visited_pb,
            "sensitive_point_books": sensitive_pb,
            "blind_spots_count": ai["blind_spots_count"],
            "visits_logged_today": len(visits),
        },
        "shift_manpower": shift_manpower,
        "vehicle_utilization": veh_status_counts,
        "priority_breakdown": {
            "P1": sum(1 for i in incidents if i["priority"] == "P1"),
            "P2": sum(1 for i in incidents if i["priority"] == "P2"),
            "P3": sum(1 for i in incidents if i["priority"] == "P3"),
        },
        "recent_incidents": incidents[:5],
        "advisories": ai["sho_advisories"][:3],
    }


@app.get("/api/shifts")
def get_shifts() -> Dict[str, Any]:
    with get_conn() as conn:
        shifts = _rows_to_dicts(conn.execute("SELECT * FROM shifts ORDER BY id").fetchall())
        officers = _rows_to_dicts(conn.execute("SELECT * FROM officers").fetchall())
        vehicles = _rows_to_dicts(conn.execute("SELECT * FROM patrol_vehicles").fetchall())
    for sh in shifts:
        sh["officers"] = [o for o in officers if o["shift_id"] == sh["id"]]
        sh["vehicles"] = [v for v in vehicles if v["shift_id"] == sh["id"]]
    return {"shifts": shifts}


@app.get("/api/officers")
def get_officers() -> Dict[str, Any]:
    with get_conn() as conn:
        rows = _rows_to_dicts(
            conn.execute(
                """
                SELECT o.*, s.shift_code, s.shift_name, s.start_time, s.end_time
                FROM officers o
                LEFT JOIN shifts s ON o.shift_id = s.id
                ORDER BY o.id
                """
            ).fetchall()
        )
    return {"officers": rows}


@app.get("/api/vehicles")
def get_vehicles() -> Dict[str, Any]:
    with get_conn() as conn:
        rows = _rows_to_dicts(
            conn.execute(
                """
                SELECT v.*, o.name AS officer_name, o.badge_no, s.shift_code
                FROM patrol_vehicles v
                LEFT JOIN officers o ON v.officer_id = o.id
                LEFT JOIN shifts s ON v.shift_id = s.id
                ORDER BY v.id
                """
            ).fetchall()
        )
    return {"vehicles": rows}


@app.post("/api/vehicles/{vehicle_id}/telemetry")
def update_vehicle_telemetry(vehicle_id: int, body: TelemetryUpdate) -> Dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM patrol_vehicles WHERE id = ?", (vehicle_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        new_status = body.status if body.status else row["status"]
        conn.execute(
            """
            UPDATE patrol_vehicles
            SET latitude = ?, longitude = ?, speed_kmh = ?, heading = ?, status = ?, last_updated = ?
            WHERE id = ?
            """,
            (body.latitude, body.longitude, body.speed_kmh, body.heading, new_status, now_iso, vehicle_id),
        )
        updated = dict(conn.execute("SELECT * FROM patrol_vehicles WHERE id = ?", (vehicle_id,)).fetchone())
    return {"vehicle": updated}


@app.get("/api/pointbooks")
def get_pointbooks(
    station: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
) -> Dict[str, Any]:
    with get_conn() as conn:
        pbs = _rows_to_dicts(conn.execute("SELECT * FROM point_books ORDER BY id").fetchall())
        plans = _rows_to_dicts(conn.execute("SELECT * FROM route_plans ORDER BY pb_id, plan_code, shift_id").fetchall())

    plan_map: Dict[int, Dict[str, Dict[int, str]]] = {}
    for pl in plans:
        pb_id = pl["pb_id"]
        plan_map.setdefault(pb_id, {}).setdefault(pl["plan_code"], {})[pl["shift_id"]] = pl["scheduled_time"]

    for pb in pbs:
        pb["plans"] = plan_map.get(pb["id"], {})

    if station and station != "All":
        pbs = [p for p in pbs if p["station"].lower() == station.lower()]
    if category and category != "All":
        pbs = [p for p in pbs if p["category"].lower() == category.lower()]
    if status and status != "All":
        pbs = [p for p in pbs if p["visit_status"].lower() == status.lower()]
    if search:
        q = search.lower()
        pbs = [
            p for p in pbs
            if q in p["pb_code"].lower() or q in p["name"].lower() or q in p["address"].lower() or q in p["station"].lower()
        ]

    return {"point_books": pbs}


@app.post("/api/pointbooks")
def create_pointbook(body: PointBookCreate) -> Dict[str, Any]:
    with get_conn() as conn:
        count = conn.execute("SELECT COUNT(*) FROM point_books").fetchone()[0]
        pb_code = body.pb_code.strip() if body.pb_code else f"PB{24000 + count + 1}"
        existing = conn.execute("SELECT id FROM point_books WHERE pb_code = ?", (pb_code,)).fetchone()
        if existing:
            pb_code = f"{pb_code}-{count + 1}"

        cur = conn.execute(
            """
            INSERT INTO point_books
            (pb_code, name, category, pb_type, sector, station, zone, district,
             holder_name, holder_mobile, latitude, longitude, address, description,
             is_sensitive, visit_status, last_visited_at, image_tag)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Non Visited', NULL, ?)
            """,
            (
                pb_code, body.name, body.category, body.pb_type, body.sector, body.station,
                body.zone, body.district, body.holder_name, body.holder_mobile,
                body.latitude, body.longitude, body.address, body.description,
                1 if body.is_sensitive else 0, body.category.lower().replace(" ", ""),
            ),
        )
        pb_id = cur.lastrowid

        defaults = {
            "PLAN A": ("08:30 AM", "03:30 PM", "11:00 PM"),
            "PLAN B": ("09:45 AM", "05:00 PM", "12:15 AM"),
            "PLAN C": ("11:15 AM", "06:30 PM", "01:45 AM"),
            "PLAN D": ("12:30 PM", "08:15 PM", "03:30 AM"),
        }
        for plan_code, (t1, t2, t3) in defaults.items():
            for shift_id, tval in [(1, t1), (2, t2), (3, t3)]:
                conn.execute(
                    "INSERT INTO route_plans (pb_id, plan_code, shift_id, scheduled_time, sequence_order) VALUES (?, ?, ?, ?, ?)",
                    (pb_id, plan_code, shift_id, tval, count + 1),
                )
        created = dict(conn.execute("SELECT * FROM point_books WHERE id = ?", (pb_id,)).fetchone())
    return {"point_book": created}


@app.put("/api/pointbooks/{pb_id}/plans")
def update_pointbook_plans(pb_id: int, body: PointBookPlansUpdate) -> Dict[str, Any]:
    with get_conn() as conn:
        pb = conn.execute("SELECT * FROM point_books WHERE id = ?", (pb_id,)).fetchone()
        if not pb:
            raise HTTPException(status_code=404, detail="Point Book not found")
        for slot in body.slots:
            conn.execute(
                """
                INSERT INTO route_plans (pb_id, plan_code, shift_id, scheduled_time, sequence_order)
                VALUES (?, ?, ?, ?, 1)
                ON CONFLICT(pb_id, plan_code, shift_id)
                DO UPDATE SET scheduled_time = excluded.scheduled_time
                """,
                (pb_id, slot.plan_code, slot.shift_id, slot.scheduled_time),
            )
        plans = _rows_to_dicts(
            conn.execute("SELECT * FROM route_plans WHERE pb_id = ?", (pb_id,)).fetchall()
        )
    return {"pb_id": pb_id, "pb_code": pb["pb_code"], "updated_slots": len(body.slots), "plans": plans}


@app.get("/api/daily-routes")
def get_daily_routes() -> Dict[str, Any]:
    with get_conn() as conn:
        assignments = _rows_to_dicts(
            conn.execute("SELECT * FROM daily_route_assignments ORDER BY station, shift_id").fetchall()
        )
        pbs = _rows_to_dicts(conn.execute("SELECT * FROM point_books ORDER BY id").fetchall())
        plans = _rows_to_dicts(conn.execute("SELECT * FROM route_plans").fetchall())

    # Group assignments by station
    station_map: Dict[str, Dict[str, Any]] = {}
    for row in assignments:
        st = row["station"]
        station_map.setdefault(st, {"station": st, "assign_date": row["assign_date"], "assigned_by": row["assigned_by"], "shifts": {}})
        station_map[st]["shifts"][str(row["shift_id"])] = row["plan_code"]

    plan_lookup = {(p["pb_id"], p["plan_code"], p["shift_id"]): p["scheduled_time"] for p in plans}

    # Build 3 shift geo-views (default shift plans across stations)
    shift_views = {}
    for s_id in (1, 2, 3):
        markers = []
        for pb in pbs:
            st_plan = station_map.get(pb["station"], {}).get("shifts", {}).get(str(s_id), "PLAN A")
            sched_time = plan_lookup.get((pb["id"], st_plan, s_id), "09:00 AM")
            markers.append({
                "pb_id": pb["id"],
                "pb_code": pb["pb_code"],
                "name": pb["name"],
                "category": pb["category"],
                "station": pb["station"],
                "plan_code": st_plan,
                "scheduled_time": sched_time,
                "visit_status": pb["visit_status"],
                "is_sensitive": pb["is_sensitive"],
                "latitude": pb["latitude"],
                "longitude": pb["longitude"],
            })
        shift_views[f"shift_{s_id}"] = markers

    return {
        "station_assignments": list(station_map.values()),
        "shift_views": shift_views,
    }


@app.post("/api/daily-routes")
def save_daily_routes(body: DailyRoutesSave) -> Dict[str, Any]:
    today_str = datetime.now().strftime("%Y-%m-%d")
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        for item in body.assignments:
            conn.execute(
                """
                INSERT INTO daily_route_assignments (assign_date, station, shift_id, plan_code, assigned_by, assigned_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(assign_date, station, shift_id)
                DO UPDATE SET plan_code = excluded.plan_code, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at
                """,
                (today_str, item.station, item.shift_id, item.plan_code, body.assigned_by, now_iso),
            )
    return {"status": "saved", "updated_count": len(body.assignments), "assigned_by": body.assigned_by}


@app.post("/api/beat-planner/recommend")
def recommend_beat_plan(body: BeatPlannerRequest) -> Dict[str, Any]:
    with get_conn() as conn:
        pbs = _rows_to_dicts(conn.execute("SELECT * FROM point_books ORDER BY id").fetchall())
        plans = _rows_to_dicts(
            conn.execute("SELECT * FROM route_plans WHERE plan_code = 'PLAN A' AND shift_id = ?", (body.shift_id,)).fetchall()
        )
    time_map = {p["pb_id"]: p["scheduled_time"] for p in plans}

    filtered = pbs
    if body.station and body.station != "All":
        filtered = [p for p in filtered if p["station"].lower() == body.station.lower()]
    if body.sector and body.sector != "All":
        sector_match = [p for p in filtered if p["sector"].lower() == body.sector.lower()]
        if sector_match:
            filtered = sector_match

    if not filtered:
        filtered = pbs[:6]

    for p in filtered:
        p["scheduled_time"] = time_map.get(p["id"], "09:00 AM")

    result = optimize_beat_route(filtered, method=body.method)
    result["station"] = body.station
    result["sector"] = body.sector
    result["route_name"] = body.route_name
    result["shift_id"] = body.shift_id
    return result


@app.get("/api/visits")
def get_visits() -> Dict[str, Any]:
    with get_conn() as conn:
        rows = _rows_to_dicts(
            conn.execute(
                """
                SELECT v.*, pb.pb_code, pb.name AS pb_name, pb.category, pb.station,
                       pv.vehicle_no, o.name AS officer_name
                FROM pb_visits v
                JOIN point_books pb ON v.pb_id = pb.id
                LEFT JOIN patrol_vehicles pv ON v.vehicle_id = pv.id
                LEFT JOIN officers o ON v.officer_id = o.id
                ORDER BY v.id DESC
                """
            ).fetchall()
        )
    return {"visits": rows}


@app.post("/api/visits")
def log_pointbook_visit(body: VisitCreate) -> Dict[str, Any]:
    with get_conn() as conn:
        pb_row = conn.execute("SELECT * FROM point_books WHERE id = ?", (body.pb_id,)).fetchone()
        if not pb_row:
            raise HTTPException(status_code=404, detail="Point Book not found")
        pb = dict(pb_row)

        plan_row = conn.execute(
            "SELECT scheduled_time FROM route_plans WHERE pb_id = ? AND plan_code = ? AND shift_id = ?",
            (body.pb_id, body.plan_code, body.shift_id),
        ).fetchone()
        sched_time = plan_row["scheduled_time"] if plan_row else "10:30 AM"

        # 30-meter geofence calculation
        if body.simulated_distance_m is not None:
            dist_m = round(float(body.simulated_distance_m), 2)
            geofence = {
                "distance_meters": dist_m,
                "radius_meters": 30.0,
                "within_geofence": dist_m <= 30.0,
                "status_label": "VERIFIED (<= 30m)" if dist_m <= 30.0 else f"OUTSIDE PERIMETER (+{round(dist_m - 30.0, 1)}m)",
            }
        else:
            o_lat = body.officer_lat if body.officer_lat is not None else pb["latitude"]
            o_lon = body.officer_lon if body.officer_lon is not None else pb["longitude"]
            geofence = check_geofence(o_lat, o_lon, pb["latitude"], pb["longitude"], radius_m=30.0)

        # Time deviation calculation
        now_local = datetime.now()
        actual_time_str = now_local.strftime("%I:%M %p")
        if body.simulated_deviation_sec is not None:
            dev_secs = abs(int(body.simulated_deviation_sec))
        else:
            sched_mins = _parse_time_to_minutes(sched_time)
            now_mins = now_local.hour * 60 + now_local.minute
            dev_secs = abs(now_mins - sched_mins) * 60 + 30
        dev_fmt = _format_hms(dev_secs)

        # Native-to-English AI translation
        trans = translate_native_to_english(body.remarks_text)
        sensitive_flag = 1 if (body.is_sensitive or trans["urgency"].startswith("High")) else 0
        new_pb_status = "Sensitive" if sensitive_flag else "Visited"
        now_iso = datetime.now(timezone.utc).isoformat()

        cur = conn.execute(
            """
            INSERT INTO pb_visits
            (pb_id, vehicle_id, officer_id, plan_code, shift_id, scheduled_time, actual_time,
             deviation_seconds, deviation_formatted, distance_meters, geofence_ok,
             remarks_native, remarks_english, sensitive_flagged, audio_simulated, visited_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                body.pb_id, body.vehicle_id, body.officer_id, body.plan_code, body.shift_id,
                sched_time, actual_time_str, dev_secs, dev_fmt,
                geofence["distance_meters"], 1 if geofence["within_geofence"] else 0,
                trans["original_text"], trans["english_translation"], sensitive_flag,
                1 if body.audio_simulated else 0, now_iso,
            ),
        )

        conn.execute(
            "UPDATE point_books SET visit_status = ?, is_sensitive = CASE WHEN ? = 1 THEN 1 ELSE is_sensitive END, last_visited_at = ? WHERE id = ?",
            (new_pb_status, sensitive_flag, now_iso, body.pb_id),
        )

        visit_record = dict(conn.execute("SELECT * FROM pb_visits WHERE id = ?", (cur.lastrowid,)).fetchone())

    return {
        "visit": visit_record,
        "geofence": geofence,
        "translation": trans,
        "new_pb_status": new_pb_status,
    }


@app.get("/api/incidents")
def get_incidents() -> Dict[str, Any]:
    with get_conn() as conn:
        rows = _rows_to_dicts(
            conn.execute(
                """
                SELECT i.*, pv.vehicle_no, pv.call_sign
                FROM incidents i
                LEFT JOIN patrol_vehicles pv ON i.assigned_vehicle_id = pv.id
                ORDER BY i.id DESC
                """
            ).fetchall()
        )
    now = datetime.now(timezone.utc)
    for row in rows:
        try:
            rep = datetime.fromisoformat(row["reported_time"].replace("Z", "+00:00"))
            if rep.tzinfo is None:
                rep = rep.replace(tzinfo=timezone.utc)
            elapsed_min = max(0, round((now - rep).total_seconds() / 60.0, 1))
        except Exception:
            elapsed_min = 5.0
        row["elapsed_minutes"] = elapsed_min
        row["sla_breached"] = bool(
            row["status"] not in ("Closed", "Settled") and elapsed_min > float(row["sla_minutes"])
        )
    return {"incidents": rows}


@app.post("/api/incidents")
def create_incident(body: IncidentCreate) -> Dict[str, Any]:
    default_prio, sla_min = SLA_MAP.get(body.incident_type, ("P2", 30))
    prio = body.priority or default_prio
    now_iso = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        cnt = conn.execute("SELECT COUNT(*) FROM incidents").fetchone()[0]
        inc_code = f"INC{100 + cnt + 1}"
        vehicles = _rows_to_dicts(conn.execute("SELECT * FROM patrol_vehicles").fetchall())
        nearest = find_nearest_vehicle(body.latitude, body.longitude, vehicles) if body.auto_assign else None
        assigned_id = nearest["id"] if nearest else None
        status = "Assigned" if assigned_id else "Open"
        io_name = "Inspector Raj Kumar" if prio == "P1" else "SI Srinivas Rao"

        cur = conn.execute(
            """
            INSERT INTO incidents
            (incident_code, incident_type, priority, sla_minutes, station, location_name,
             latitude, longitude, description, caller_phone, reported_time, status,
             assigned_vehicle_id, investigating_officer, diversion_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                inc_code, body.incident_type, prio, sla_min, body.station, body.location_name,
                body.latitude, body.longitude, body.description, body.caller_phone,
                now_iso, status, assigned_id, io_name, 1 if assigned_id else 0,
            ),
        )
        if assigned_id:
            conn.execute("UPDATE patrol_vehicles SET status = 'Responding' WHERE id = ?", (assigned_id,))
        created = dict(conn.execute("SELECT * FROM incidents WHERE id = ?", (cur.lastrowid,)).fetchone())

    return {"incident": created, "nearest_vehicle": nearest}


@app.put("/api/incidents/{incident_id}/close")
def close_incident(incident_id: int, body: IncidentClose) -> Dict[str, Any]:
    with get_conn() as conn:
        inc = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        if not inc:
            raise HTTPException(status_code=404, detail="Incident not found")
        conn.execute(
            """
            UPDATE incidents
            SET status = 'Closed', action_taken = ?, closure_comments = ?, diversion_active = 0
            WHERE id = ?
            """,
            (body.action_taken, body.closure_comments, incident_id),
        )
        if inc["assigned_vehicle_id"]:
            conn.execute(
                "UPDATE patrol_vehicles SET status = 'On Patrol' WHERE id = ?",
                (inc["assigned_vehicle_id"],),
            )
        updated = dict(conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone())
    return {"incident": updated}


# ---------------------------------------------------------------------------
# Dial 100 Diversion State Machine (PatrolManagement_dark.png)
# ---------------------------------------------------------------------------

def _get_points_balance_summary(conn) -> Dict[str, Any]:
    pbs = _rows_to_dicts(conn.execute("SELECT * FROM point_books ORDER BY id").fetchall())
    total = len(pbs)
    visited = [p for p in pbs if p["visit_status"] == "Visited"]
    remaining = [p for p in pbs if p["visit_status"] != "Visited"]
    return {
        "total_points": total,
        "visited_count": len(visited),
        "remaining_count": len(remaining),
        "remaining_points": remaining[:8],
    }


@app.get("/api/dispatch/state")
def get_dispatch_state() -> Dict[str, Any]:
    with get_conn() as conn:
        sess = conn.execute("SELECT * FROM dial100_sessions ORDER BY id DESC LIMIT 1").fetchone()
        session_dict = dict(sess) if sess else {"state": "ROUTE_DECIDE"}
        inc = None
        veh = None
        if session_dict.get("incident_id"):
            r = conn.execute("SELECT * FROM incidents WHERE id = ?", (session_dict["incident_id"],)).fetchone()
            inc = dict(r) if r else None
        if session_dict.get("vehicle_id"):
            r = conn.execute("SELECT * FROM patrol_vehicles WHERE id = ?", (session_dict["vehicle_id"],)).fetchone()
            veh = dict(r) if r else None
        balance = _get_points_balance_summary(conn)
    return {
        "session": session_dict,
        "incident": inc,
        "diverted_vehicle": veh,
        "points_balance": balance,
    }


@app.post("/api/dispatch/trigger")
def trigger_dial100_diversion(body: DispatchTrigger) -> Dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()
    _, sla_min = SLA_MAP.get(body.incident_type, ("P1", 10))
    with get_conn() as conn:
        cnt = conn.execute("SELECT COUNT(*) FROM incidents").fetchone()[0]
        inc_code = f"D100-{200 + cnt + 1}"
        vehicles = _rows_to_dicts(conn.execute("SELECT * FROM patrol_vehicles").fetchall())
        nearest = find_nearest_vehicle(body.latitude, body.longitude, vehicles)
        veh_id = nearest["id"] if nearest else None

        cur_inc = conn.execute(
            """
            INSERT INTO incidents
            (incident_code, incident_type, priority, sla_minutes, station, location_name,
             latitude, longitude, description, caller_phone, reported_time, status,
             assigned_vehicle_id, investigating_officer, diversion_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Dial-100', ?, 'Assigned', ?, 'SHO / Control Room', 1)
            """,
            (
                inc_code, body.incident_type, body.priority, sla_min, body.station, body.location_name,
                body.latitude, body.longitude, body.description, now_iso, veh_id,
            ),
        )
        inc_id = cur_inc.lastrowid
        if veh_id:
            conn.execute("UPDATE patrol_vehicles SET status = 'Diverted' WHERE id = ?", (veh_id,))

        balance = _get_points_balance_summary(conn)
        conn.execute(
            """
            INSERT INTO dial100_sessions
            (incident_id, vehicle_id, state, total_points_today, visited_points_today, remaining_points, diverted_at, notes)
            VALUES (?, ?, 'ROUTE_DIVERSION', ?, ?, ?, ?, ?)
            """,
            (
                inc_id, veh_id, balance["total_points"], balance["visited_count"],
                balance["remaining_count"], now_iso,
                f"Dial 100 {body.priority} {body.incident_type} call received; nearest unit diverted.",
            ),
        )
    return get_dispatch_state()


@app.post("/api/dispatch/complete-call")
def complete_dial100_call(body: DispatchComplete) -> Dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        sess = conn.execute("SELECT * FROM dial100_sessions ORDER BY id DESC LIMIT 1").fetchone()
        if not sess:
            raise HTTPException(status_code=400, detail="No active Dial 100 session")
        if sess["incident_id"]:
            conn.execute(
                "UPDATE incidents SET status = 'Closed', action_taken = ?, closure_comments = ?, diversion_active = 0 WHERE id = ?",
                (body.action_taken, body.notes, sess["incident_id"]),
            )
        balance = _get_points_balance_summary(conn)
        conn.execute(
            """
            UPDATE dial100_sessions
            SET state = 'POINTS_BALANCE',
                total_points_today = ?,
                visited_points_today = ?,
                remaining_points = ?,
                completed_at = ?,
                notes = ?
            WHERE id = ?
            """,
            (balance["total_points"], balance["visited_count"], balance["remaining_count"], now_iso, body.notes, sess["id"]),
        )
    return get_dispatch_state()


@app.post("/api/dispatch/decision")
def dispatch_post_call_decision(body: DispatchDecision) -> Dict[str, Any]:
    with get_conn() as conn:
        sess = conn.execute("SELECT * FROM dial100_sessions ORDER BY id DESC LIMIT 1").fetchone()
        if not sess:
            raise HTTPException(status_code=400, detail="No active Dial 100 session")
        new_state = "CONTINUED_ROUTE" if body.decision == "continue" else "DAY_CLOSED"
        new_veh_status = "On Patrol" if body.decision == "continue" else "Available"
        note = (
            "Patrol unit resumed remaining beat Point Books."
            if body.decision == "continue"
            else "Shift day closed and remaining point balance carried to next shift."
        )
        if sess["vehicle_id"]:
            conn.execute("UPDATE patrol_vehicles SET status = ? WHERE id = ?", (new_veh_status, sess["vehicle_id"]))
        conn.execute(
            "UPDATE dial100_sessions SET state = ?, notes = ? WHERE id = ?",
            (new_state, note, sess["id"]),
        )
    return get_dispatch_state()


# ---------------------------------------------------------------------------
# AI & Analytics Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/ai/insights")
def get_ai_insights() -> Dict[str, Any]:
    with get_conn() as conn:
        pbs = _rows_to_dicts(conn.execute("SELECT * FROM point_books ORDER BY id").fetchall())
        incs = _rows_to_dicts(conn.execute("SELECT * FROM incidents").fetchall())
        ch = _rows_to_dicts(conn.execute("SELECT * FROM colleges_hotspots").fetchall())
    return generate_ai_insights(pbs, incs, ch)


@app.post("/api/ai/translate")
def translate_text(body: TranslateRequest) -> Dict[str, Any]:
    return translate_native_to_english(body.text)


@app.get("/api/reports/analytics")
def get_reports_analytics() -> Dict[str, Any]:
    with get_conn() as conn:
        visits = _rows_to_dicts(
            conn.execute(
                """
                SELECT v.*, pb.pb_code, pb.name AS pb_name, pb.category, pb.station,
                       pv.vehicle_no, o.name AS officer_name
                FROM pb_visits v
                JOIN point_books pb ON v.pb_id = pb.id
                LEFT JOIN patrol_vehicles pv ON v.vehicle_id = pv.id
                LEFT JOIN officers o ON v.officer_id = o.id
                ORDER BY v.id DESC
                """
            ).fetchall()
        )
        incidents = _rows_to_dicts(conn.execute("SELECT * FROM incidents ORDER BY id DESC").fetchall())
        pbs = _rows_to_dicts(conn.execute("SELECT * FROM point_books").fetchall())
        ch = _rows_to_dicts(conn.execute("SELECT * FROM colleges_hotspots").fetchall())

    avg_dev_sec = round(sum(v["deviation_seconds"] for v in visits) / len(visits), 1) if visits else 0
    geofence_pass = sum(1 for v in visits if v["geofence_ok"])
    diversions_count = sum(1 for i in incidents if i["caller_phone"] == "Dial-100")

    event_offender_monitor = [
        {
            "event_name": "Public Gardens Dharna & Assembly",
            "location": "Abids / Nampally",
            "watchlist_offenders": 4,
            "assigned_unit": "BC3 (Blue Colt)",
            "status": "Active Surveillance",
        },
        {
            "event_name": "Khairatabad Ganesh Mandap Rush",
            "location": "Khairatabad Circle",
            "watchlist_offenders": 7,
            "assigned_unit": "PV003 (Panjagutta)",
            "status": "Picket Deployed",
        },
        {
            "event_name": "College Gate Dispersal Window",
            "location": "Nampally / Gachibowli",
            "watchlist_offenders": 3,
            "assigned_unit": "TS09PA1001",
            "status": "Geofence Active",
        },
    ]

    return {
        "summary": {
            "total_visits": len(visits),
            "avg_deviation_formatted": _format_hms(int(avg_dev_sec)),
            "geofence_compliance_pct": round((geofence_pass / len(visits)) * 100, 1) if visits else 100.0,
            "emergency_calls_during_patrol": diversions_count,
            "covered_hotspots": sum(1 for pb in pbs if pb["visit_status"] in ("Visited", "Sensitive")),
            "total_hotspots": len(ch),
        },
        "visits_audit": visits,
        "event_offender_monitor": event_offender_monitor,
    }


@app.get("/api/reports/export.csv")
def export_reports_csv() -> PlainTextResponse:
    analytics = get_reports_analytics()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Visit ID", "PointBook Code", "PointBook Name", "Station", "Plan", "Shift",
        "Scheduled Time", "Actual Time", "Deviation", "Distance (m)", "Geofence OK",
        "Native Remarks", "English Police Log", "Sensitive Flagged", "Visited At",
    ])
    for v in analytics["visits_audit"]:
        writer.writerow([
            v["id"], v["pb_code"], v["pb_name"], v["station"], v["plan_code"], v["shift_id"],
            v["scheduled_time"], v["actual_time"], v["deviation_formatted"], v["distance_meters"],
            "YES" if v["geofence_ok"] else "NO", v["remarks_native"], v["remarks_english"],
            "YES" if v["sensitive_flagged"] else "NO", v["visited_at"],
        ])
    return PlainTextResponse(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=tscop_patrol_deviation_report.csv"},
    )
