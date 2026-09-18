'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  HiOutlineArrowRightOnRectangle,
  HiOutlineBuildingOffice2,
  HiOutlineHandRaised,
  HiOutlineTruck,
  HiOutlineMapPin,
  HiOutlinePlay,
  HiOutlineStop,
  HiOutlineVideoCamera,
  HiOutlineExclamationTriangle,
  HiOutlineViewfinderCircle,
} from 'react-icons/hi2'
import BarrierPanel from '@/components/gate/BarrierPanel'
import DetectionFeed from '@/components/gate/DetectionFeed'
import LiveSurface from '@/components/gate/LiveSurface'
import StatsCard from '@/components/common/StatsCard'
import { useGate } from '@/context/GateContext'
import useLaneReader from '@/hooks/useLaneReader'
import { GATE_NAME, PARK_NAME } from '@/data/registry'

// How long a cleared vehicle holds the barrier open before the lane re-arms.
// Long enough for a car to pull through, short enough that the screen is ready
// for the one behind it.
const OPEN_MS = 6000

/** Entry lanes only — this screen has no business judging a vehicle leaving. */
const isEntryLane = (camera) => !camera.lane.startsWith('Exit')

export default function EntryGatePage() {
  const { cameras, events, registry, stats, authorize } = useGate()

  const entryCameras = useMemo(() => cameras.filter(isEntryLane), [cameras])
  const [cameraId, setCameraId] = useState(() => {
    const first = cameras.find(isEntryLane)
    return first ? first.id : cameras[0].id
  })
  const [running, setRunning] = useState(false)

  const camera = entryCameras.find((c) => c.id === cameraId) || entryCameras[0] || cameras[0]
  const lane = camera.lane

  const { latest, error: readerError } = useLaneReader(camera, running)

  // The barrier holds open for a moment after a plate clears, then re-arms.
  // Tracked by read id rather than by the read itself so two vehicles with the
  // same plate — the same car turning around — each get their own opening.
  const [seenId, setSeenId] = useState(null)
  const [holdingOpen, setHoldingOpen] = useState(false)
  if (latest && latest.id !== seenId) {
    setSeenId(latest.id)
    setHoldingOpen(latest.decision === 'granted')
  }

  useEffect(() => {
    if (!holdingOpen) return undefined
    const timer = setTimeout(() => setHoldingOpen(false), OPEN_MS)
    return () => clearTimeout(timer)
  }, [holdingOpen, seenId])

  // Stopping the reader closes the gate whatever the last verdict was: a lane
  // nobody is watching must not be left showing "open".
  const barrier = !running
    ? 'idle'
    : holdingOpen
      ? 'open'
      : latest && latest.decision === 'denied'
        ? 'held'
        : 'armed'

  // Looked up on every render, not captured with the read: issuing a pass for
  // the vehicle at the barrier has to change this panel immediately.
  const vehicle = latest ? registry.find((v) => v.plate === latest.plate) || null : null

  // The whole log is shared, so the feed and the counts below filter it down to
  // the lanes this screen is responsible for.
  const entryLanes = useMemo(() => new Set(entryCameras.map((c) => c.lane)), [entryCameras])
  const entryEvents = useMemo(
    () => events.filter((e) => entryLanes.has(e.lane)),
    [events, entryLanes],
  )
  const turnedAway = entryEvents.filter((e) => e.decision === 'denied').length

  if (entryCameras.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center">
        <h1 className="text-lg font-bold text-slate-800">Entry Gate</h1>
        <p className="text-sm text-slate-500 mt-2">
          No entry lane is configured. Add a camera whose lane is not an exit in{' '}
          <span className="plate text-xs">src/data/registry.js</span> and it appears here.
        </p>
      </div>
    )
  }

  const pill = !running
    ? { text: 'Stopped', dot: 'bg-slate-400', cls: 'bg-slate-100 text-slate-500 border-slate-200' }
    : readerError
      ? { text: 'Reader down', dot: 'bg-red-500', cls: 'bg-red-50 text-red-700 border-red-200' }
      : { text: 'Reading', dot: 'bg-green-500', cls: 'bg-green-50 text-green-700 border-green-200' }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Entry Gate</h1>
        <p className="text-sm text-slate-500 mt-1">
          The gatehouse screen for vehicles coming in. Every plate read on an entry lane is
          matched against the tenant allow-list, and the barrier follows the answer.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatsCard
          icon={HiOutlineArrowRightOnRectangle}
          label="Entries today"
          value={stats.entries}
          color="success"
          subtitle="barrier opened"
        />
        <StatsCard
          icon={HiOutlineBuildingOffice2}
          label="Inside now"
          value={stats.inside}
          color="primary"
          subtitle="vehicles on campus"
        />
        <StatsCard
          icon={HiOutlineHandRaised}
          label="Turned away"
          value={turnedAway}
          color="danger"
          subtitle="not on allow-list"
        />
        <StatsCard
          icon={HiOutlineTruck}
          label="Allow-list"
          value={stats.registered}
          color="warning"
          subtitle="plates registered"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <select
            suppressHydrationWarning
            value={camera.id}
            onChange={(e) => setCameraId(e.target.value)}
            className="text-base font-bold text-slate-800 bg-transparent border-0 p-0 pr-6 focus:outline-none cursor-pointer"
            aria-label="Entry lane"
          >
            {entryCameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="flex items-center gap-1 text-xs text-slate-400 mt-0.5 truncate">
            <HiOutlineMapPin className="w-3.5 h-3.5 shrink-0" />
            {PARK_NAME} · {GATE_NAME} · {lane}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${pill.cls}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${pill.dot} ${running ? 'animate-pulse' : ''}`}
            />
            {pill.text}
          </span>
          <button
            suppressHydrationWarning
            onClick={() => setRunning((r) => !r)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              running
                ? 'bg-white text-red-600 border-red-200 hover:bg-red-50'
                : 'bg-primary-600 text-white border-primary-600 hover:bg-primary-700'
            }`}
          >
            {running ? <HiOutlineStop className="w-4 h-4" /> : <HiOutlinePlay className="w-4 h-4" />}
            {running ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>

      {running && readerError && (
        <p className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700">
          <HiOutlineExclamationTriangle className="w-4 h-4 shrink-0" />
          <span className="min-w-0">
            No plates are being read — {readerError}. Nothing reaches the barrier until it
            answers again.
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-4">
          <BarrierPanel
            state={barrier}
            verdict={latest}
            vehicle={vehicle}
            onIssuePass={() => latest && authorize(latest.plate)}
          />

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <HiOutlineVideoCamera className="w-5 h-5 text-primary-600" />
                {camera.name}
              </h3>
              <Link
                href="/live"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors"
              >
                <HiOutlineViewfinderCircle className="w-4 h-4" />
                Bind source · set detection area
              </Link>
            </div>

            <LiveSurface camera={camera} running={running} latest={latest} />

            <p className="px-5 py-2.5 border-t border-slate-100 text-[11px] text-slate-400 truncate">
              {camera.source
                ? `${camera.source.url}${camera.source.stream ? ' · via bridge' : ''}`
                : 'No source bound — bind this camera on Live View for the reader to work from'}
            </p>
          </div>
        </div>

        <DetectionFeed detections={entryEvents} live={running} />
      </div>
    </div>
  )
}
