'use client'

import { useEffect, useRef, useState } from 'react'
import { useGate } from '@/context/GateContext'
import { fetchReads } from '@/lib/bridge'

// How often the UI asks the bridge what it has read. The reader itself works
// at its own pace on every moving frame; this only decides how quickly a plate
// it has already found reaches the screen.
const POLL_MS = 1200

// Reads are identified by the bridge, which numbers them per camera and never
// reuses one. Prefixing keeps two cameras' reads apart in the shared log, and
// the log outlives the page that made it — it sits in GateContext, above the
// route — so an id has to be unique for longer than that page is mounted.
const passIdOf = (cameraId, read) => `read-${cameraId}-${read.id}`

/**
 * Read plates off one camera for as long as `running` holds.
 *
 * Every page that watches a lane needs the same three things — poll the
 * bridge, decide each plate against the allow-list, write the pass to the
 * shared log — and getting any of them subtly different between two pages
 * would mean the same vehicle was judged differently depending on which screen
 * was open. So it lives here once, and Live View and Entry Gate both call it.
 *
 * The decision is made in the browser, against the allow-list: the reader says
 * what the plate is, never whether it may come in.
 *
 * @returns {{live: Array, latest: object|null, error: string|null}} reads made
 *   during this run, newest first, and why the reader is silent if it is.
 */
export default function useLaneReader(camera, running) {
  const { registry, recordPass } = useGate()
  const [live, setLive] = useState([])
  const [error, setError] = useState(null)

  const lane = camera.lane

  // Switching camera starts a different lane's run, so the previous lane's
  // reads go with it. Done during render rather than in an effect so the feed
  // never paints one camera's plates under another camera's name.
  const [bound, setBound] = useState(camera.id)
  if (bound !== camera.id) {
    setBound(camera.id)
    setLive([])
    setError(null)
  }

  // Registry lookups have to be current: a plate authorised on the Alerts page
  // must clear the barrier the next time it is read here.
  const registryRef = useRef(registry)
  useEffect(() => {
    registryRef.current = registry
  }, [registry])

  // Held in a ref so recording a pass does not restart the interval below.
  const recordRef = useRef(recordPass)
  useEffect(() => {
    recordRef.current = recordPass
  })

  // Where the bridge's read log was last read up to. Held in a ref so a poll
  // that lands mid-render still advances from the right place.
  const cursor = useRef(0)

  useEffect(() => {
    if (!running) return undefined
    let alive = true
    cursor.current = 0

    const poll = async () => {
      try {
        const { seq, reads } = await fetchReads(camera.id, cursor.current)
        if (!alive) return
        setError(null)
        if (!reads.length) return
        // The watermark is the top-level `seq` — the bridge numbers its reads
        // but does not repeat that number inside each one. Advancing on a
        // per-read `seq` therefore left the cursor at 0 forever, and every poll
        // handed back the same plates again: one vehicle, re-judged and
        // re-logged every 1.2s.
        cursor.current = Math.max(cursor.current, seq || 0, ...reads.map((r) => r.seq || 0))

        const passes = reads.map((read) => {
          const known = registryRef.current.some((v) => v.plate === read.plate)
          return {
            id: passIdOf(camera.id, read),
            plate: read.plate,
            lane,
            direction: lane.startsWith('Exit') ? 'out' : 'in',
            confidence: read.confidence,
            // The reader sees a plate, not a body style. Claiming "Car" for a
            // lorry would be inventing detail the camera never gave us.
            type: 'Vehicle',
            crop: read.crop,
            time: new Date(read.at * 1000).toLocaleTimeString('en-GB', { hour12: false }),
            decision: known ? 'granted' : 'denied',
          }
        })
        // Newest first, to match the way the feed and the overlay read.
        const ordered = [...passes].reverse()
        setLive((prev) => [...ordered, ...prev])
        ordered.forEach((pass) => recordRef.current(pass))
      } catch (err) {
        if (alive) setError(err.message)
      }
    }

    poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [running, camera.id, lane])

  return { live, latest: live[0] || null, error }
}
