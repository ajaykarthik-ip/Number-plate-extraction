'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { allowedVehicles, seedEvents, cameras as seedCameras, formatPlate } from '@/data/registry'
import { registerCamera } from '@/lib/bridge'

const GateContext = createContext(null)

// Nothing is on campus until movements are logged. Raise this if a demo needs
// the park to start out occupied.
const BASE_INSIDE = 0

// Bound camera sources are the one piece of demo state worth keeping: a reload
// that forgets them sends you back to the connect form every time.
const STORE_KEY = 'autogate.cameras.v1'

// The allow-list ships empty, so anything in it was registered by hand and
// losing it on reload would make the page useless.
const REGISTRY_KEY = 'autogate.registry.v1'

/** Keep the hand-built allow-list across reloads. */
function persistRegistry(list) {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(list))
  } catch {
    // Private mode, or storage disabled — the list lasts this session only.
  }
}

/** Update one camera's stored source, leaving the rest of the map alone. */
function persistOne(id, source) {
  try {
    const map = JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
    map[id] = source
    localStorage.setItem(STORE_KEY, JSON.stringify(map))
  } catch {
    // Nothing to do — the binding still works for this session.
  }
}

/** Save just the sources, keyed by camera. Everything else is seed data. */
function persist(list) {
  try {
    const map = {}
    list.forEach((c) => {
      if (c.source) map[c.id] = c.source
    })
    localStorage.setItem(STORE_KEY, JSON.stringify(map))
  } catch {
    // Private mode, or storage disabled. The binding still works for this
    // session — it just will not survive a reload.
  }
}

export function GateProvider({ children }) {
  const [registry, setRegistry] = useState(allowedVehicles)
  const [events, setEvents] = useState(seedEvents)
  const [cameras, setCameras] = useState(seedCameras)

  // Read after mount, never during render: the site is exported as static HTML
  // with no sources in it, so reading storage any earlier would hydrate a tree
  // that does not match the served markup.
  useEffect(() => {
    let saved = null
    let savedRegistry = null
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
      savedRegistry = JSON.parse(localStorage.getItem(REGISTRY_KEY) || 'null')
    } catch {
      return
    }
    if (Array.isArray(savedRegistry)) {
      // Restoring browser-only state on mount is what this effect exists for.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRegistry(savedRegistry)
    }
    if (!saved) return
    // Restoring browser-only state on mount is what this effect exists for.
    setCameras((prev) =>
      prev.map((c) => (saved[c.id] ? { ...c, status: 'configured', source: saved[c.id] } : c)),
    )
    // Every stored rtsp:// source claims its slot again on load. That covers
    // two cases at once: a bridge that has restarted and forgotten its
    // cameras, and an entry written by an older build that saved the RTSP
    // address as a playable HTTP source. Both heal without anyone clearing
    // storage by hand; a bridge that is down says so instead of going quiet.
    let reported = false
    Object.entries(saved).forEach(([id, source]) => {
      if (!/^rtsp:\/\//i.test(source.url || '')) return
      registerCamera(id, source.url)
        .then((stream) => {
          const healed = { protocol: 'rtsp', url: source.url, stream }
          setCameras((prev) =>
            prev.map((c) => (c.id === id ? { ...c, status: 'configured', source: healed } : c)),
          )
          persistOne(id, healed)
        })
        .catch((err) => {
          // Swallowing this is what made a reload look like the feed had simply
          // stopped working. The source stays saved so a retry costs one click,
          // but the reason is said out loud — once, however many cameras failed
          // for the same reason.
          if (reported) return
          reported = true
          toast.error(err.message, { id: 'bridge-rebind', duration: 6000 })
        })
    })
  }, [])

  // No ANPR service is running yet, so connecting a camera only stores the
  // source. Status stays 'configured' until a backend confirms the stream.
  const connectCamera = (id, source) => {
    const next = cameras.map((c) => (c.id === id ? { ...c, status: 'configured', source } : c))
    setCameras(next)
    persist(next)
    toast.success('Camera source saved')
  }

  const disconnectCamera = (id) => {
    const next = cameras.map((c) => (c.id === id ? { ...c, status: 'pending', source: null } : c))
    setCameras(next)
    persist(next)
  }

  // Live View is the only thing that writes here. A pass is recorded exactly as
  // the reader saw it and is never rewritten afterwards: a plate authorised
  // later still shows its earlier "Blocked" row, which is what an audit record
  // is for. Session-only — the log starts empty on every load.
  const recordPass = (pass) => {
    setEvents((prev) => [pass, ...prev].slice(0, 500))
  }

  const authorize = (plate, details = {}) => {
    if (registry.some((v) => v.plate === plate)) {
      toast(`${formatPlate(plate)} is already on the allow-list`)
      return
    }
    const next = [
      ...registry,
      {
        id: Date.now(),
        plate,
        owner: details.owner || 'Pending verification',
        tenant: details.tenant || 'Visitor bay',
        type: details.type || 'Car',
        category: details.category || 'Visitor',
        pass: details.pass || 'TMP-' + String(registry.length + 1).padStart(4, '0'),
        validTill: details.validTill || '2026-12-31',
      },
    ]
    setRegistry(next)
    persistRegistry(next)
    toast.success(`${formatPlate(plate)} added to the allow-list`)
  }

  // Empties the allow-list in one go, storage included. Revoking plate by plate
  // left the key behind with the last few rows in it, so a reload brought them
  // back — the point of this is that nothing survives it.
  const clearRegistry = () => {
    const held = registry.length
    setRegistry([])
    try {
      localStorage.removeItem(REGISTRY_KEY)
    } catch {
      // Storage is unavailable, so there was nothing persisted to remove.
    }
    // The log carries plates too, and keeping it would leave them on screen in
    // Logs and Alerts after the list they belong to is gone.
    setEvents([])
    toast.success(
      held ? `Removed ${held} plate${held === 1 ? '' : 's'}` : 'There were no plates to remove',
    )
  }

  const revoke = (plate) => {
    const next = registry.filter((v) => v.plate !== plate)
    setRegistry(next)
    persistRegistry(next)
    toast(`${formatPlate(plate)} removed from the allow-list`, { icon: '🚫' })
  }

  const stats = useMemo(() => {
    const granted = events.filter((e) => e.decision === 'granted')
    const denied = events.filter((e) => e.decision === 'denied')
    const entries = granted.filter((e) => e.direction === 'in').length
    const exits = granted.filter((e) => e.direction === 'out').length
    return {
      total: events.length,
      granted: granted.length,
      denied: denied.length,
      entries,
      exits,
      inside: BASE_INSIDE + entries - exits,
      registered: registry.length,
      unknownPlates: [...new Set(denied.map((e) => e.plate))],
      accuracy: events.length
        ? Math.round((events.reduce((s, e) => s + e.confidence, 0) / events.length) * 100)
        : 0,
    }
  }, [events, registry])

  const alerts = useMemo(() => events.filter((e) => e.decision === 'denied'), [events])
  const camerasConnected = cameras.filter((c) => c.status !== 'pending').length

  return (
    <GateContext.Provider
      value={{
        registry,
        events,
        alerts,
        stats,
        cameras,
        camerasConnected,
        connectCamera,
        disconnectCamera,
        recordPass,
        authorize,
        revoke,
        clearRegistry,
      }}
    >
      {children}
    </GateContext.Provider>
  )
}

export function useGate() {
  const ctx = useContext(GateContext)
  if (!ctx) throw new Error('useGate must be used inside GateProvider')
  return ctx
}
