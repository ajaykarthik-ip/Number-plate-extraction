// Hard-coded demo data for the IT-park gate pitch. No backend yet — the whole
// app runs off this file plus the simulated event loop in GateContext.

export const PARK_NAME = 'Ascendas Tech Park'
export const GATE_NAME = 'Gate 1 — Main Boulevard'

export const tenants = [
  'Nexora Systems — Block A',
  'Vantage Analytics — Block B',
  'Helix Software — Block C',
  'Park Facilities',
  'Cygnet Logistics (vendor)',
]

// Empty on purpose: the allow-list is built in the Allowed Vehicles page and
// kept in the browser from there. Seed rows here would come back every time
// storage was cleared and fight whatever was registered by hand.
export const allowedVehicles = []

// Emptied on request — every plate that used to be replayed here is gone.
// The Live View loop walks this list, so with nothing in it the pane no longer
// invents reads: it waits for a real one. Nothing else reads this export, so
// leaving it declared and empty keeps the loop's shape for whenever an ANPR
// engine starts feeding it.
export const detectionScript = []

// Empty on purpose: the movement log fills from the Live View loop. Seeded
// rows would need fixed timestamps anyway — anything generated at render time
// (Date.now, Math.random) differs between server and client and trips React
// hydration, so live entries only get real clock times after mount.
export const seedEvents = []

// Hourly in/out flow for the dashboard chart.
export const hourlyFlow = [
  { hour: '06:00', inCount: 6,  outCount: 1 },
  { hour: '07:00', inCount: 24, outCount: 3 },
  { hour: '08:00', inCount: 48, outCount: 5 },
  { hour: '09:00', inCount: 61, outCount: 9 },
  { hour: '10:00', inCount: 33, outCount: 14 },
  { hour: '11:00', inCount: 18, outCount: 12 },
  { hour: '12:00', inCount: 21, outCount: 26 },
  { hour: '13:00', inCount: 27, outCount: 31 },
  { hour: '14:00', inCount: 14, outCount: 18 },
  { hour: '15:00', inCount: 11, outCount: 22 },
]

export const weeklyTrend = [
  { day: 'Mon', total: 412, denied: 9 },
  { day: 'Tue', total: 388, denied: 6 },
  { day: 'Wed', total: 436, denied: 12 },
  { day: 'Thu', total: 401, denied: 5 },
  { day: 'Fri', total: 471, denied: 15 },
  { day: 'Sat', total: 148, denied: 3 },
  { day: 'Sun', total: 62,  denied: 1 },
]

// Split of the day traffic by pass category — drives the donut.
export const categorySplit = [
  { label: 'Employee', value: 186 },
  { label: 'Cab',      value: 74 },
  { label: 'Vendor',   value: 41 },
  { label: 'Facility', value: 18 },
  { label: 'Visitor',  value: 27 },
]

// Occupancy per block, for the panel that answers who is inside right now.
export const blockOccupancy = [
  { block: 'Block A — Nexora Systems',    inside: 62, capacity: 90 },
  { block: 'Block B — Vantage Analytics', inside: 48, capacity: 80 },
  { block: 'Block C — Helix Software',    inside: 39, capacity: 70 },
  { block: 'Visitor / vendor bay',        inside: 17, capacity: 40 },
]

// No stream is bound yet — every camera sits in "pending" until the ANPR
// backend is connected. Flip status to 'online' once a feed exists.
export const cameras = [
  { id: 'cam-1', name: 'Gate 1 — Entry',   lane: 'Entry — Lane 1', status: 'pending', fps: 0 },
  { id: 'cam-2', name: 'Gate 1 — Entry B', lane: 'Entry — Lane 2', status: 'pending', fps: 0 },
  { id: 'cam-3', name: 'Gate 2 — Exit',    lane: 'Exit — Lane 3',  status: 'pending', fps: 0 },
  { id: 'cam-4', name: 'Basement ramp',    lane: 'Exit — Lane 4',  status: 'pending', fps: 0 },
]

export function formatPlate(plate) {
  // TN09BX4521 -> TN 09 BX 4521
  const m = /^([A-Z]{2})(\d{2})([A-Z]{1,3})(\d{1,4})$/.exec(plate)
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : plate
}
