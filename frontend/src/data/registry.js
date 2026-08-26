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

export const allowedVehicles = [
  { id: 1,  plate: 'TN09BX4521', owner: 'R. Karthik',       tenant: 'Nexora Systems — Block A',    type: 'Car',   category: 'Employee', pass: 'EMP-1042', validTill: '2026-12-31' },
  { id: 2,  plate: 'TN22AC1188', owner: 'Priya Nandhini',   tenant: 'Vantage Analytics — Block B', type: 'Car',   category: 'Employee', pass: 'EMP-0871', validTill: '2026-10-15' },
  { id: 3,  plate: 'TN10CJ7745', owner: 'Cygnet Logistics', tenant: 'Cygnet Logistics (vendor)',   type: 'Truck', category: 'Vendor',   pass: 'VEN-3310', validTill: '2026-09-30' },
  { id: 4,  plate: 'KA05MJ2093', owner: 'S. Vignesh',       tenant: 'Helix Software — Block C',    type: 'Car',   category: 'Employee', pass: 'EMP-1550', validTill: '2027-01-20' },
  { id: 5,  plate: 'TN07DK3390', owner: 'Park Shuttle 2',   tenant: 'Park Facilities',             type: 'Bus',   category: 'Facility', pass: 'FLT-0002', validTill: '2027-03-31' },
  { id: 6,  plate: 'TN18AZ6612', owner: 'M. Fathima',       tenant: 'Helix Software — Block C',    type: 'Bike',  category: 'Employee', pass: 'EMP-2204', validTill: '2026-11-11' },
  { id: 7,  plate: 'AP39QL8801', owner: 'Sundaram Parts',   tenant: 'Park Facilities',             type: 'Truck', category: 'Vendor',   pass: 'VEN-3419', validTill: '2026-12-01' },
  { id: 8,  plate: 'TN01BF9034', owner: 'D. Anitha',        tenant: 'Nexora Systems — Block A',    type: 'Car',   category: 'Employee', pass: 'EMP-0619', validTill: '2027-02-28' },
  { id: 9,  plate: 'TN11GH2255', owner: 'Rapido Cabs',      tenant: 'Park Facilities',             type: 'Car',   category: 'Cab',      pass: 'CAB-0117', validTill: '2026-10-31' },
  { id: 10, plate: 'TN04LP7712', owner: 'Arun Prakash',     tenant: 'Vantage Analytics — Block B', type: 'Car',   category: 'Employee', pass: 'EMP-1903', validTill: '2027-04-15' },
]

// The live loop walks this list forever. Plates absent from the registry above
// are the "new vehicle" cases the gate has to stop.
export const detectionScript = [
  { plate: 'TN09BX4521', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.98, type: 'Car' },
  { plate: 'TN10CJ7745', lane: 'Entry — Lane 2', direction: 'in',  confidence: 0.96, type: 'Truck' },
  { plate: 'MH12GT7788', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.91, type: 'Car' },
  { plate: 'TN22AC1188', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.97, type: 'Car' },
  { plate: 'TN07DK3390', lane: 'Exit — Lane 3',  direction: 'out', confidence: 0.99, type: 'Bus' },
  { plate: 'DL8CAF1122', lane: 'Entry — Lane 2', direction: 'in',  confidence: 0.88, type: 'Truck' },
  { plate: 'KA05MJ2093', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.95, type: 'Car' },
  { plate: 'TN11GH2255', lane: 'Exit — Lane 3',  direction: 'out', confidence: 0.93, type: 'Car' },
  { plate: 'TN33XR0099', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.85, type: 'Car' },
  { plate: 'AP39QL8801', lane: 'Entry — Lane 2', direction: 'in',  confidence: 0.94, type: 'Truck' },
  { plate: 'TN01BF9034', lane: 'Exit — Lane 4',  direction: 'out', confidence: 0.98, type: 'Car' },
  { plate: 'TN18AZ6612', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.92, type: 'Bike' },
  { plate: 'TN04LP7712', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.96, type: 'Car' },
  { plate: 'TN09BX4521', lane: 'Exit — Lane 3',  direction: 'out', confidence: 0.97, type: 'Car' },
]

// Seeded with fixed timestamps on purpose: anything generated at render time
// (Date.now, Math.random) differs between server and client and trips React
// hydration. Live entries get real clock times, but only after mount.
export const seedEvents = [
  { id: 's1',  plate: 'TN09BX4521', time: '09:12:04', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.97, decision: 'granted' },
  { id: 's2',  plate: 'TN22AC1188', time: '09:08:41', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.95, decision: 'granted' },
  { id: 's3',  plate: 'HR26DQ5511', time: '09:03:17', lane: 'Entry — Lane 2', direction: 'in',  confidence: 0.87, decision: 'denied'  },
  { id: 's4',  plate: 'TN10CJ7745', time: '08:57:52', lane: 'Entry — Lane 2', direction: 'in',  confidence: 0.99, decision: 'granted' },
  { id: 's5',  plate: 'TN07DK3390', time: '08:49:30', lane: 'Exit — Lane 3',  direction: 'out', confidence: 0.98, decision: 'granted' },
  { id: 's6',  plate: 'KA05MJ2093', time: '08:44:09', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.94, decision: 'granted' },
  { id: 's7',  plate: 'MH12GT7788', time: '08:38:55', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.90, decision: 'denied'  },
  { id: 's8',  plate: 'TN18AZ6612', time: '08:31:12', lane: 'Entry — Lane 2', direction: 'in',  confidence: 0.93, decision: 'granted' },
  { id: 's9',  plate: 'AP39QL8801', time: '08:22:40', lane: 'Entry — Lane 2', direction: 'in',  confidence: 0.96, decision: 'granted' },
  { id: 's10', plate: 'TN01BF9034', time: '08:15:03', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.98, decision: 'granted' },
  { id: 's11', plate: 'GJ01KM4477', time: '08:06:28', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.84, decision: 'denied'  },
  { id: 's12', plate: 'TN11GH2255', time: '07:58:11', lane: 'Exit — Lane 3',  direction: 'out', confidence: 0.99, decision: 'granted' },
  { id: 's13', plate: 'TN04LP7712', time: '07:51:47', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.96, decision: 'granted' },
  { id: 's14', plate: 'TN09BX4521', time: '07:44:22', lane: 'Entry — Lane 1', direction: 'in',  confidence: 0.99, decision: 'granted' },
]

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
