-- ============================================================================
-- TSCOP / SafeOS Smart Patrol & Beat Management System
-- Production PostgreSQL 18 + PostGIS Spatial Schema Reference
-- Note: The demo runs out-of-the-box with Python SQLite (zero DB setup),
--       while this DDL provides full PostgreSQL + PostGIS production parity.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS shifts (
    shift_id    SERIAL PRIMARY KEY,
    shift_code  VARCHAR(20) UNIQUE NOT NULL,
    shift_name  VARCHAR(50) NOT NULL,
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL,
    focus_areas TEXT
);

CREATE TABLE IF NOT EXISTS officers (
    officer_id   SERIAL PRIMARY KEY,
    badge_no     VARCHAR(20) UNIQUE NOT NULL,
    officer_name VARCHAR(100) NOT NULL,
    designation  VARCHAR(50) NOT NULL,
    role         VARCHAR(20) NOT NULL DEFAULT 'PC', -- SHO, ADMIN, SI, PC
    station      VARCHAR(80) NOT NULL,
    mobile       VARCHAR(15),
    shift_id     INT REFERENCES shifts(shift_id),
    status       VARCHAR(30) DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS patrol_vehicles (
    vehicle_id   SERIAL PRIMARY KEY,
    vehicle_no   VARCHAR(20) UNIQUE NOT NULL,
    call_sign    VARCHAR(30),
    vehicle_type VARCHAR(30) NOT NULL DEFAULT 'Patrol Car', -- Patrol Car / Blue Colt
    zone         VARCHAR(50),
    station      VARCHAR(80),
    officer_id   INT REFERENCES officers(officer_id),
    shift_id     INT REFERENCES shifts(shift_id),
    status       VARCHAR(30) DEFAULT 'On Patrol',
    latitude     NUMERIC(10, 6),
    longitude    NUMERIC(10, 6),
    geom         GEOGRAPHY(POINT, 4326),
    active_plan  VARCHAR(20) DEFAULT 'PLAN A',
    last_updated TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS point_books (
    pb_id            SERIAL PRIMARY KEY,
    pb_code          VARCHAR(30) UNIQUE NOT NULL,
    name             VARCHAR(150) NOT NULL,
    category         VARCHAR(60) NOT NULL,
    pb_type          VARCHAR(60) NOT NULL,
    sector           VARCHAR(60) NOT NULL,
    station          VARCHAR(80) NOT NULL,
    zone             VARCHAR(30) DEFAULT 'EZ',
    district         VARCHAR(50) DEFAULT 'HYDERABAD',
    holder_name      VARCHAR(100),
    holder_mobile    VARCHAR(20),
    latitude         NUMERIC(10, 6) NOT NULL,
    longitude        NUMERIC(10, 6) NOT NULL,
    geom             GEOGRAPHY(POINT, 4326),
    address          TEXT,
    description      TEXT,
    is_sensitive     BOOLEAN DEFAULT FALSE,
    visit_status     VARCHAR(30) DEFAULT 'Non Visited',
    last_visited_at  TIMESTAMP
);

CREATE TABLE IF NOT EXISTS route_plans (
    plan_id        SERIAL PRIMARY KEY,
    pb_id          INT REFERENCES point_books(pb_id) ON DELETE CASCADE,
    plan_code      VARCHAR(20) NOT NULL, -- PLAN A, PLAN B, PLAN C, PLAN D
    shift_id       INT REFERENCES shifts(shift_id),
    scheduled_time VARCHAR(20) NOT NULL,
    sequence_order INT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pb_visits (
    visit_id            SERIAL PRIMARY KEY,
    pb_id               INT REFERENCES point_books(pb_id),
    vehicle_id          INT REFERENCES patrol_vehicles(vehicle_id),
    officer_id          INT REFERENCES officers(officer_id),
    plan_code           VARCHAR(20),
    shift_id            INT REFERENCES shifts(shift_id),
    scheduled_time      VARCHAR(20),
    actual_time         VARCHAR(20),
    deviation_seconds   INT DEFAULT 0,
    deviation_formatted VARCHAR(30),
    distance_meters     NUMERIC(10, 2),
    geofence_ok         BOOLEAN DEFAULT FALSE,
    remarks_native      TEXT,
    remarks_english     TEXT,
    sensitive_flagged   BOOLEAN DEFAULT FALSE,
    visited_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incidents (
    incident_id          SERIAL PRIMARY KEY,
    incident_code        VARCHAR(30) UNIQUE NOT NULL,
    incident_type        VARCHAR(100) NOT NULL,
    priority             VARCHAR(5) NOT NULL, -- P1, P2, P3
    sla_minutes          INT NOT NULL DEFAULT 30,
    station              VARCHAR(80),
    location_name        VARCHAR(150),
    latitude             NUMERIC(10, 6) NOT NULL,
    longitude            NUMERIC(10, 6) NOT NULL,
    geom                 GEOGRAPHY(POINT, 4326),
    description          TEXT,
    reported_time        TIMESTAMP DEFAULT NOW(),
    status               VARCHAR(30) DEFAULT 'Open',
    assigned_vehicle     INT REFERENCES patrol_vehicles(vehicle_id),
    investigating_officer VARCHAR(100),
    action_taken         VARCHAR(100),
    closure_comments     TEXT
);

CREATE TABLE IF NOT EXISTS colleges (
    college_id   SERIAL PRIMARY KEY,
    college_name VARCHAR(200) NOT NULL,
    station      VARCHAR(80),
    latitude     NUMERIC(10, 6) NOT NULL,
    longitude    NUMERIC(10, 6) NOT NULL,
    geom         GEOGRAPHY(POINT, 4326),
    radius_m     INT DEFAULT 250
);

CREATE INDEX IF NOT EXISTS idx_vehicles_geom ON patrol_vehicles USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_pb_geom       ON point_books USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_incidents_geom ON incidents USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_colleges_geom ON colleges USING GIST (geom);

-- Sample 30-meter geofence check query in PostGIS:
-- SELECT pb_code, ST_DWithin(geom, ST_SetSRID(ST_MakePoint(78.4712, 17.3976), 4326)::geography, 30) AS within_30m
-- FROM point_books;
