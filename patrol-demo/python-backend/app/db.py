"""
SQLite Spatial Demo Database Initializer & Seed Data for TSCOP / SafeOS Patrol Management.
Zero-setup alternative to PostgreSQL + PostGIS for instant local evaluation.
"""

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
from typing import Iterator

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "patrol_demo.db"


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(DB_PATH), timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shift_code TEXT UNIQUE NOT NULL,
            shift_name TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            focus_areas TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS officers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            badge_no TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            designation TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'PC',
            station TEXT NOT NULL,
            mobile TEXT NOT NULL,
            shift_id INTEGER REFERENCES shifts(id),
            status TEXT NOT NULL DEFAULT 'Active'
        );

        CREATE TABLE IF NOT EXISTS patrol_vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_no TEXT UNIQUE NOT NULL,
            call_sign TEXT NOT NULL,
            vehicle_type TEXT NOT NULL,
            zone TEXT NOT NULL,
            station TEXT NOT NULL,
            officer_id INTEGER REFERENCES officers(id),
            shift_id INTEGER REFERENCES shifts(id),
            status TEXT NOT NULL DEFAULT 'On Patrol',
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            speed_kmh REAL NOT NULL DEFAULT 28.0,
            heading INTEGER NOT NULL DEFAULT 45,
            active_plan TEXT NOT NULL DEFAULT 'PLAN A',
            last_updated TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS point_books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pb_code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            pb_type TEXT NOT NULL,
            sector TEXT NOT NULL,
            station TEXT NOT NULL,
            zone TEXT NOT NULL DEFAULT 'EZ',
            district TEXT NOT NULL DEFAULT 'HYDERABAD',
            holder_name TEXT NOT NULL,
            holder_mobile TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            address TEXT NOT NULL,
            description TEXT NOT NULL,
            is_sensitive INTEGER NOT NULL DEFAULT 0,
            visit_status TEXT NOT NULL DEFAULT 'Non Visited',
            last_visited_at TEXT,
            image_tag TEXT NOT NULL DEFAULT 'atm'
        );

        CREATE TABLE IF NOT EXISTS route_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pb_id INTEGER NOT NULL REFERENCES point_books(id) ON DELETE CASCADE,
            plan_code TEXT NOT NULL,
            shift_id INTEGER NOT NULL REFERENCES shifts(id),
            scheduled_time TEXT NOT NULL,
            sequence_order INTEGER NOT NULL DEFAULT 1,
            UNIQUE(pb_id, plan_code, shift_id)
        );

        CREATE TABLE IF NOT EXISTS daily_route_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assign_date TEXT NOT NULL,
            station TEXT NOT NULL,
            shift_id INTEGER NOT NULL REFERENCES shifts(id),
            plan_code TEXT NOT NULL,
            assigned_by TEXT NOT NULL,
            assigned_at TEXT NOT NULL,
            UNIQUE(assign_date, station, shift_id)
        );

        CREATE TABLE IF NOT EXISTS pb_visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pb_id INTEGER NOT NULL REFERENCES point_books(id),
            vehicle_id INTEGER REFERENCES patrol_vehicles(id),
            officer_id INTEGER REFERENCES officers(id),
            plan_code TEXT NOT NULL,
            shift_id INTEGER NOT NULL,
            scheduled_time TEXT NOT NULL,
            actual_time TEXT NOT NULL,
            deviation_seconds INTEGER NOT NULL DEFAULT 0,
            deviation_formatted TEXT NOT NULL,
            distance_meters REAL NOT NULL,
            geofence_ok INTEGER NOT NULL DEFAULT 1,
            remarks_native TEXT,
            remarks_english TEXT,
            sensitive_flagged INTEGER NOT NULL DEFAULT 0,
            audio_simulated INTEGER NOT NULL DEFAULT 0,
            visited_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            incident_code TEXT UNIQUE NOT NULL,
            incident_type TEXT NOT NULL,
            priority TEXT NOT NULL,
            sla_minutes INTEGER NOT NULL,
            station TEXT NOT NULL,
            location_name TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            description TEXT NOT NULL,
            caller_phone TEXT NOT NULL DEFAULT 'Dial-100',
            reported_time TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Open',
            assigned_vehicle_id INTEGER REFERENCES patrol_vehicles(id),
            investigating_officer TEXT,
            action_taken TEXT,
            closure_comments TEXT,
            diversion_active INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS dial100_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            incident_id INTEGER REFERENCES incidents(id),
            vehicle_id INTEGER REFERENCES patrol_vehicles(id),
            state TEXT NOT NULL DEFAULT 'ROUTE_DECIDE',
            total_points_today INTEGER NOT NULL DEFAULT 14,
            visited_points_today INTEGER NOT NULL DEFAULT 5,
            remaining_points INTEGER NOT NULL DEFAULT 9,
            diverted_at TEXT,
            completed_at TEXT,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS colleges_hotspots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            station TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            radius_m INTEGER NOT NULL DEFAULT 250,
            risk_score INTEGER NOT NULL DEFAULT 75,
            advisory_text TEXT NOT NULL,
            peak_hours TEXT NOT NULL
        );
        """
    )


def seed_database(force_reset: bool = False) -> None:
    with get_conn() as conn:
        if force_reset:
            conn.executescript(
                """
                PRAGMA foreign_keys = OFF;
                DROP TABLE IF EXISTS dial100_sessions;
                DROP TABLE IF EXISTS pb_visits;
                DROP TABLE IF EXISTS daily_route_assignments;
                DROP TABLE IF EXISTS route_plans;
                DROP TABLE IF EXISTS incidents;
                DROP TABLE IF EXISTS patrol_vehicles;
                DROP TABLE IF EXISTS point_books;
                DROP TABLE IF EXISTS officers;
                DROP TABLE IF EXISTS shifts;
                DROP TABLE IF EXISTS colleges_hotspots;
                PRAGMA foreign_keys = ON;
                """
            )
        init_schema(conn)
        existing = conn.execute("SELECT COUNT(*) FROM shifts").fetchone()[0]
        if existing > 0 and not force_reset:
            return

        now = datetime.now(timezone.utc)
        today_str = datetime.now().strftime("%Y-%m-%d")

        # 1. Shifts
        shifts_data = [
            ("SHIFT-1", "Shift A (Morning)", "06:00 AM", "02:00 PM", "School/College opening, bank cash vans, VIP corridors"),
            ("SHIFT-2", "Shift B (Afternoon)", "02:00 PM", "10:00 PM", "College dismissals, evening commercial rush, mandaps & wine shops"),
            ("SHIFT-3", "Shift C (Night)", "10:00 PM", "06:00 AM", "Night anti-burglary beats, ATM guards, blind-spot surveillance"),
        ]
        conn.executemany(
            "INSERT INTO shifts (shift_code, shift_name, start_time, end_time, focus_areas) VALUES (?, ?, ?, ?, ?)",
            shifts_data,
        )

        # 2. Officers
        officers_data = [
            ("SHO-ABIDS", "SHO Abids Inspector", "Station House Officer", "SHO", "Abids PS", "9848011001", 1, "Active"),
            ("B101", "Raj Kumar", "Inspector", "SHO", "Gachibowli PS", "9848011101", 1, "Active"),
            ("B102", "Srinivas Rao", "Sub-Inspector (SI)", "SI", "Abids PS", "9848011102", 2, "Active"),
            ("B103", "Mahesh Babu", "Police Constable", "PC", "Nallakunta PS", "9848011103", 3, "Active"),
            ("BC-301", "Srihari Narayanan", "Head Constable (BC3)", "PC", "Raidurgam PS", "9848011301", 1, "Active"),
            ("BC-302", "E. Sathaiah", "Police Constable", "PC", "Abids PS", "9848011302", 1, "Active"),
            ("CTRL-01", "Praveen Tallakokula", "Control Room Dispatcher", "ADMIN", "Hyderabad Control Room", "9848011900", 1, "Active"),
            ("PC-401", "Ramesh Goud", "Patrol Officer", "PC", "Panjagutta PS", "9848011401", 2, "Active"),
            ("PC-402", "Kumar Swamy", "Patrol Officer", "PC", "Madhapur PS", "9848011402", 1, "Active"),
        ]
        conn.executemany(
            "INSERT INTO officers (badge_no, name, designation, role, station, mobile, shift_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            officers_data,
        )

        # 3. Patrol Vehicles
        now_iso = now.isoformat()
        vehicles_data = [
            ("TS09PA1001", "PC-ABIDS-1", "Patrol Car", "East Zone", "Abids PS", 6, 1, "On Patrol", 17.3924, 78.4755, 24.0, 60, "PLAN A", now_iso),
            ("BC3", "BLUE-COLT-3", "Blue Colt", "EZ", "Abids PS", 5, 1, "On Patrol", 17.3974, 78.4710, 18.0, 120, "PLAN A", now_iso),
            ("TS09PA1002", "PC-GCH-1", "Patrol Car", "West Zone", "Gachibowli PS", 2, 1, "Available", 17.4410, 78.3502, 0.0, 0, "PLAN A", now_iso),
            ("TS09PA1003", "PC-RDG-1", "Patrol Car", "West Zone", "Raidurgam PS", 9, 2, "Responding", 17.4375, 78.3840, 42.0, 210, "PLAN B", now_iso),
            ("BC7-GCH", "BLUE-COLT-7", "Blue Colt", "West Zone", "Madhapur PS", 8, 2, "On Patrol", 17.4495, 78.3790, 22.0, 90, "PLAN C", now_iso),
            ("PV003", "PC-PNJ-1", "Patrol Car", "Central Zone", "Panjagutta PS", 8, 1, "Available", 17.4240, 78.4530, 14.0, 315, "PLAN A", now_iso),
        ]
        conn.executemany(
            """
            INSERT INTO patrol_vehicles
            (vehicle_no, call_sign, vehicle_type, zone, station, officer_id, shift_id, status, latitude, longitude, speed_kmh, heading, active_plan, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            vehicles_data,
        )

        # 4. Point Books (Real Hyderabad coordinates matching screenshots + docs)
        recent_2h = (now - timedelta(hours=2)).isoformat()
        recent_4h = (now - timedelta(hours=4)).isoformat()
        stale_15h = (now - timedelta(hours=15)).isoformat()
        stale_19h = (now - timedelta(hours=19)).isoformat()
        stale_26h = (now - timedelta(hours=26)).isoformat()

        point_books_data = [
            ("PBA226471", "Andhra Bank ATM - Public Gardens", "ATM", "Security Guard", "Sector-1", "Abids PS", "EZ", "HYDERABAD",
             "Rajendra Prasad", "9899754222", 17.3976, 78.4712, "5-10-174, Fateh Maidan Rd, Public Gardens, Nampally, 500004",
             "High-footfall ATM opposite Public Gardens; requires night guard check.", 0, "Non Visited", stale_15h, "atm"),
            ("PB23243", "State Bank ATM - Abids Circle", "ATM", "Security Guard", "Abids", "Abids PS", "EZ", "HYDERABAD",
             "Rajendra", "9899754222", 17.3906, 78.4774, "Flat 102, Balaji Apartments, Shanthi Colony, Abids, 500002",
             "Commercial jewelry & banking cluster ATM.", 1, "Visited", recent_2h, "atm"),
            ("PB-COL-01", "Nampally Junior & Degree College", "College", "Picket", "Sector-1", "Abids PS", "EZ", "HYDERABAD",
             "Dr. Venkatesh (Principal)", "9848022110", 17.3935, 78.4695, "Station Road, Nampally, Hyderabad, 500001",
             "College entry/dispersal safety point; monitor outsider loitering.", 1, "Non Visited", stale_19h, "college"),
            ("PB-WIN-02", "Panjagutta Metro Wine Shop", "Wine Shop", "Point book Holder", "Sector-2", "Panjagutta PS", "CZ", "HYDERABAD",
             "K. Narasimha", "9848033221", 17.4265, 78.4512, "Panjagutta X Roads, Main Road, Hyderabad, 500082",
             "Late-evening crowd surge hotspot; closing time enforcement at 10:30 PM.", 1, "Sensitive", recent_4h, "wineshop"),
            ("PB-GAN-03", "Khairatabad Ganesh Mandap Point", "Mandap/Pandal", "Ganesh Pandal", "Sector-1", "Khairatabad PS", "CZ", "HYDERABAD",
             "Mandap Committee Lead", "9848044332", 17.4126, 78.4602, "Khairatabad Circle, Mint Compound Road, 500004",
             "Major festival pandal & dense commuter junction.", 1, "Non Visited", stale_26h, "pandal"),
            ("PB-GOV-01", "Telangana Secretariat South Gate", "Govt Office", "Check Post", "Sector-1", "Abids PS", "EZ", "HYDERABAD",
             "Duty Inspector Reserve", "9848055443", 17.4052, 78.4685, "Secretariat Road, Hussain Sagar South, 500022",
             "VIP & Dharna sensitive perimeter.", 1, "Visited", recent_2h, "govt"),
            ("PB-HOS-04", "Nallakunta Fever Hospital Gate", "Hospital", "Senior Citizen", "Sector-3", "Nallakunta PS", "EZ", "HYDERABAD",
             "Security Supervisor", "9848066554", 17.3992, 78.5038, "Vidyanagar Main Rd, Nallakunta, 500044",
             "24x7 emergency hospital gate & senior citizen corridor.", 0, "Visited", recent_4h, "hospital"),
            ("PB-SCH-05", "St. Alberts High School Gate", "School", "Polling Booth", "Sector-2", "Abids PS", "EZ", "HYDERABAD",
             "Mrs. Padma (Head)", "9848077665", 17.3868, 78.4728, "Aghapura Main Rd, Nampally, 500001",
             "School drop-off/pickup visibility & designated polling center.", 0, "Non Visited", stale_15h, "school"),
            ("PB-GCH-01", "UoH Men's Hostel L (MH-L)", "College", "Picket", "Sector-II", "Gachibowli PS", "WZ", "HYDERABAD",
             "Chief Warden UoH", "9848088776", 17.4565, 78.3324, "University of Hyderabad Campus, Gachibowli, 500046",
             "Campus hostel perimeter & late-night student safety beat.", 0, "Non Visited", stale_19h, "college"),
            ("PB-GCH-02", "Indian School of Business (ISB) Gate", "College", "Security Guard", "Sector-II", "Gachibowli PS", "WZ", "HYDERABAD",
             "ISB Chief Security", "9848099887", 17.4325, 78.3412, "ISB Road, Financial District, Gachibowli, 500032",
             "Western-aqua-route campus & IT corridor checkpoint.", 0, "Visited", recent_2h, "college"),
            ("PB-GCH-03", "Indira Nagar Bus Stop & Ratnadeep", "Crime Hotspot", "Check Post", "Sector-I", "Gachibowli PS", "WZ", "HYDERABAD",
             "Market Assoc. Lead", "9848012345", 17.4445, 78.3618, "Old Bombay Road, Indira Nagar, Gachibowli, 500032",
             "Crime-oriented beat point along Old Bombay Road corridor.", 1, "Non Visited", stale_26h, "hotspot"),
            ("PB-MAD-01", "Kotak Global & Meridian School", "Bank", "Security Guard", "Sector-I", "Madhapur PS", "WZ", "HYDERABAD",
             "Branch Manager", "9848023456", 17.4504, 78.3812, "HITEC City Main Road, Madhapur, 500081",
             "IT corridor financial & school concentration.", 0, "Visited", recent_4h, "bank"),
            ("PB-RDG-01", "Mindspace & Inorbit Mall Gate", "Shopping Mall", "Durga Matha Mandap", "Sector-II", "Raidurgam PS", "WZ", "HYDERABAD",
             "Mall Security Chief", "9848034567", 17.4356, 78.3864, "Mindspace IT Park, Raidurgam, 500081",
             "Weekend high-density shopping mall & IT hub.", 0, "Sensitive", recent_2h, "mall"),
            ("PB-JWL-01", "Abids Jewelry Bazaar Corridor", "Crime Hotspot", "Check Post", "Abids", "Abids PS", "EZ", "HYDERABAD",
             "Jewelers Assoc. Pres.", "9848045678", 17.3889, 78.4761, "Tilak Road, Abids Jewelry Market, 500001",
             "Predictive AI static visibility point during closing hours.", 1, "Non Visited", stale_19h, "hotspot"),
        ]
        conn.executemany(
            """
            INSERT INTO point_books
            (pb_code, name, category, pb_type, sector, station, zone, district, holder_name, holder_mobile,
             latitude, longitude, address, description, is_sensitive, visit_status, last_visited_at, image_tag)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            point_books_data,
        )

        # 5. Route Plans (Plan A, B, C, D across Shift 1, 2, 3)
        pb_ids = [r[0] for r in conn.execute("SELECT id FROM point_books ORDER BY id").fetchall()]
        shift1_slots = ["07:30 AM", "08:50 AM", "09:45 AM", "10:30 AM", "11:45 AM", "12:45 PM"]
        shift2_slots = ["02:30 PM", "03:45 PM", "04:20 PM", "05:15 PM", "06:45 PM", "08:30 PM"]
        shift3_slots = ["10:30 PM", "11:45 PM", "12:30 AM", "01:45 AM", "03:15 AM", "04:45 AM"]

        plan_rows = []
        for idx, pb_id in enumerate(pb_ids):
            for p_offset, plan_code in enumerate(["PLAN A", "PLAN B", "PLAN C", "PLAN D"]):
                # Rotate times per plan so Criminals cannot predict patrol pattern!
                s1 = shift1_slots[(idx + p_offset) % len(shift1_slots)]
                s2 = shift2_slots[(idx + p_offset * 2) % len(shift2_slots)]
                s3 = shift3_slots[(idx + p_offset) % len(shift3_slots)]
                if pb_id == 1 and plan_code == "PLAN A":
                    s1 = "10:30 AM"  # Match screenshot image6.jpeg for PBA226471!
                plan_rows.append((pb_id, plan_code, 1, s1, idx + 1))
                plan_rows.append((pb_id, plan_code, 2, s2, idx + 1))
                plan_rows.append((pb_id, plan_code, 3, s3, idx + 1))

        conn.executemany(
            "INSERT INTO route_plans (pb_id, plan_code, shift_id, scheduled_time, sequence_order) VALUES (?, ?, ?, ?, ?)",
            plan_rows,
        )

        # 6. Daily Route Assignments (matching image3.jpeg & image4.jpeg)
        stations_plans = [
            ("Abids PS", "PLAN A", "PLAN C", "PLAN D"),
            ("Panjagutta PS", "PLAN A", "PLAN B", "PLAN A"),
            ("Khairatabad PS", "PLAN A", "PLAN B", "PLAN C"),
            ("Lakdikapul PS", "PLAN A", "PLAN B", "PLAN A"),
            ("Gachibowli PS", "PLAN B", "PLAN C", "PLAN D"),
            ("Madhapur PS", "PLAN A", "PLAN C", "PLAN B"),
            ("Raidurgam PS", "PLAN B", "PLAN A", "PLAN D"),
            ("Nallakunta PS", "PLAN A", "PLAN B", "PLAN C"),
        ]
        for st, p1, p2, p3 in stations_plans:
            for sh_id, pl in [(1, p1), (2, p2), (3, p3)]:
                conn.execute(
                    """
                    INSERT INTO daily_route_assignments (assign_date, station, shift_id, plan_code, assigned_by, assigned_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (today_str, st, sh_id, pl, "SHO_ABIDS", now_iso),
                )

        # 7. Incidents (matching Patrolling Use cases.docx + Deck)
        incidents_data = [
            ("INC001", "Murder", "P1", 10, "Gachibowli PS", "Wipro Circle / Financial District", 17.4435, 78.3772,
             "Urgent Dial 100 report: homicide scene near construction perimeter; nearest patrol & IO dispatched.", "Dial-100",
             (now - timedelta(minutes=6)).isoformat(), "Assigned", 3, "Inspector Raj Kumar", None, None, 0),
            ("INC002", "Armed Robbery", "P2", 15, "Abids PS", "Tilak Road Jewelry Lane, Abids", 17.4465, 78.3810,
             "Two suspects fled on motorbike near ATM kiosk; evidence collection & CCTV sweep active.", "Citizen App",
             (now - timedelta(minutes=11)).isoformat(), "In Progress", 4, "SI Srinivas Rao", None, None, 0),
            ("INC003", "College Security Alert", "P2", 20, "Abids PS", "Nampally Junior College Gate", 17.3935, 78.4695,
             "Suspicious outsider group reported outside college gate during dispersal window.", "College Principal",
             (now - timedelta(minutes=4)).isoformat(), "Open", None, None, None, None, 0),
            ("WSCMP1637", "Public Nuisance", "P3", 60, "Raidurgam PS", "Mindspace Gate 2", 17.4362, 78.3852,
             "Late evening traffic obstruction and noise complaint near food court lane.", "Dial-100",
             (now - timedelta(minutes=38)).isoformat(), "In Progress", 5, "HC Srihari Narayanan", None, None, 0),
            ("WSSOS2436", "Theft", "P2", 30, "Panjagutta PS", "Panjagutta Metro Exit", 17.4258, 78.4519,
             "Mobile phone snatching complaint reported by commuter.", "Dial-100",
             (now - timedelta(hours=2)).isoformat(), "Closed", 6, "PC Ramesh Goud", "Settled", "Suspect apprehended at check post; FIR logged.", 0),
        ]
        conn.executemany(
            """
            INSERT INTO incidents
            (incident_code, incident_type, priority, sla_minutes, station, location_name, latitude, longitude,
             description, caller_phone, reported_time, status, assigned_vehicle_id, investigating_officer,
             action_taken, closure_comments, diversion_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            incidents_data,
        )

        # 8. Historical PB Visits (showing exact 00:02:30 HRS deviation & Telugu translation)
        visits_data = [
            (2, 1, 6, "PLAN A", 1, "08:50 AM", "08:52 AM", 150, "00:02:30 HRS", 14.2, 1,
             "ఏటీఎం వద్ద భద్రత బాగానే ఉంది, అనుమానాస్పద కదలికలు లేవు",
             "ATM premises checked; security guard present and no suspicious activity observed.", 0, 1, recent_2h),
            (4, 6, 8, "PLAN A", 2, "09:45 PM", "09:53 PM", 480, "00:08:00 HRS", 21.8, 1,
             "వైన్ షాప్ వద్ద రద్దీ ఎక్కువగా ఉంది, అదనపు గస్తీ అవసరం",
             "Heavy crowd gathering observed near the wine shop; additional Blue Colts patrol presence advised.", 1, 1, recent_4h),
            (6, 2, 5, "PLAN A", 1, "09:15 AM", "09:16 AM", 60, "00:01:00 HRS", 9.5, 1,
             "Secretariat south gate picket checked; traffic normal.",
             "Field Observation: Secretariat south gate picket checked; traffic normal.", 0, 0, recent_2h),
        ]
        conn.executemany(
            """
            INSERT INTO pb_visits
            (pb_id, vehicle_id, officer_id, plan_code, shift_id, scheduled_time, actual_time,
             deviation_seconds, deviation_formatted, distance_meters, geofence_ok,
             remarks_native, remarks_english, sensitive_flagged, audio_simulated, visited_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            visits_data,
        )

        # 9. Dial 100 initial session
        conn.execute(
            """
            INSERT INTO dial100_sessions
            (incident_id, vehicle_id, state, total_points_today, visited_points_today, remaining_points, notes)
            VALUES (NULL, 2, 'ROUTE_DECIDE', 14, 5, 9, 'Normal beat patrolling active on PLAN A (Shift 1).')
            """
        )

        # 10. Colleges & Crime Hotspots
        ch_data = [
            ("Nampally Junior & Degree College", "College", "Abids PS", 17.3935, 78.4695, 250, 78,
             "Monitor entry/exit gates 08:30-09:30 AM and 04:00-05:15 PM.", "08:30-09:30, 16:00-17:15"),
            ("University of Hyderabad Campus", "College", "Gachibowli PS", 17.4565, 78.3324, 400, 72,
             "Maintain night patrol loop around Men's/Women's hostels & main gate.", "18:00-23:00"),
            ("Indian School of Business (ISB)", "College", "Gachibowli PS", 17.4325, 78.3412, 300, 60,
             "Routine campus perimeter check.", "08:00-20:00"),
            ("Abids Jewelry & Banking Hotspot", "Crime Hotspot", "Abids PS", 17.3889, 78.4761, 200, 92,
             "High-value jewelry shops; static visibility required at closing hours.", "19:30-23:30"),
            ("Public Gardens Dharna Assembly Zone", "Event/Dharna", "Abids PS", 17.3976, 78.4712, 300, 85,
             "Frequent protest / assembly notifications; keep BC3 nearby.", "10:00-16:00"),
            ("Old Bombay Road Blind Spot Cluster", "Crime Hotspot", "Gachibowli PS", 17.4445, 78.3618, 250, 88,
             "Low street lighting after 10 PM; snatching & vehicle crime risk.", "21:00-03:00"),
            ("Panjagutta Wine Shop & Mall Hub", "Crime Hotspot", "Panjagutta PS", 17.4265, 78.4512, 220, 84,
             "Crowd management required during late evening & weekends.", "19:00-23:30"),
        ]
        conn.executemany(
            """
            INSERT INTO colleges_hotspots
            (name, kind, station, latitude, longitude, radius_m, risk_score, advisory_text, peak_hours)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ch_data,
        )
