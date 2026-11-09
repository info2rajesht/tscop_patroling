/**
 * ============================================================================
 * Real-Time Patrol Telemetry Simulator
 * Generates continuous GPS movement coordinates along Hyderabad beat corridors.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

const PATROL_CIRCUITS = {
  TS09PA1001: [
    [17.3924, 78.4755], [17.3906, 78.4774], [17.3889, 78.4761], [17.3915, 78.4730], [17.3955, 78.4718]
  ],
  BC3: [
    [17.3974, 78.4710], [17.3976, 78.4712], [17.3935, 78.4695], [17.3895, 78.4720], [17.3948, 78.4742]
  ],
  TS09PA1002: [
    [17.4410, 78.3502], [17.4445, 78.3618], [17.4380, 78.3490], [17.4325, 78.3412]
  ],
  TS09PA1003: [
    [17.4375, 78.3840], [17.4356, 78.3864], [17.4402, 78.3820], [17.4435, 78.3772]
  ],
  "BC7-GCH": [
    [17.4495, 78.3790], [17.4504, 78.3812], [17.4472, 78.3755]
  ],
  PV003: [
    [17.4240, 78.4530], [17.4265, 78.4512], [17.4198, 78.4565], [17.4126, 78.4602]
  ]
};

let simTick = 0;
let isRunning = true;

function stepTelemetry(vehicles) {
  if (!isRunning) return vehicles;
  simTick += 1;

  return vehicles.map(v => {
    if (v.status === "Available") return v;
    const circuit = PATROL_CIRCUITS[v.vehicle_no];
    if (!circuit || circuit.length === 0) return v;

    const segments = circuit.length;
    const pos = (simTick + (v.id * 3)) % (segments * 8);
    const segIdx = Math.floor(pos / 8);
    const frac = (pos % 8) / 8.0;

    const p1 = circuit[segIdx % segments];
    const p2 = circuit[(segIdx + 1) % segments];

    const lat = p1[0] + (p2[0] - p1[0]) * frac;
    const lon = p1[1] + (p2[1] - p1[1]) * frac;
    const heading = Math.round((Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180) / Math.PI + 360) % 360;

    return {
      ...v,
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lon.toFixed(6)),
      heading,
      speed_kmh: v.status === "Diverted" ? 45 : 24,
    };
  });
}

module.exports = {
  stepTelemetry,
  toggleSimulation: () => { isRunning = !isRunning; return isRunning; },
  isSimulationRunning: () => isRunning,
};
