'use client'

import { createContext, useContext, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { allowedVehicles, seedEvents, cameras as seedCameras, formatPlate } from '@/data/registry'

const GateContext = createContext(null)

// Vehicles already parked inside when the records were taken.
const BASE_INSIDE = 148

export function GateProvider({ children }) {
  const [registry, setRegistry] = useState(allowedVehicles)
  const [events] = useState(seedEvents)
  const [cameras, setCameras] = useState(seedCameras)

  // No ANPR service is running yet, so connecting a camera only stores the
  // source. Status stays 'configured' until a backend confirms the stream.
  const connectCamera = (id, source) => {
    setCameras((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'configured', source } : c)),
    )
    toast.success('Camera source saved')
  }

  const disconnectCamera = (id) => {
    setCameras((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'pending', source: null } : c)),
    )
  }

  const authorize = (plate, details = {}) => {
    setRegistry((prev) => {
      if (prev.some((v) => v.plate === plate)) return prev
      return [
        ...prev,
        {
          id: Date.now(),
          plate,
          owner: details.owner || 'Pending verification',
          tenant: details.tenant || 'Visitor bay',
          type: details.type || 'Car',
          category: details.category || 'Visitor',
          pass: details.pass || 'TMP-' + String(prev.length + 1).padStart(4, '0'),
          validTill: details.validTill || '2026-12-31',
        },
      ]
    })
    toast.success(`${formatPlate(plate)} added to the allow-list`)
  }

  const revoke = (plate) => {
    setRegistry((prev) => prev.filter((v) => v.plate !== plate))
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
        authorize,
        revoke,
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
