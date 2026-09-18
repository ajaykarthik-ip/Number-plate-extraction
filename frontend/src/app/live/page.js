'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  HiOutlineArrowLeft,
  HiOutlineMapPin,
  HiOutlineVideoCamera,
  HiOutlineViewfinderCircle,
  HiOutlinePlay,
  HiOutlineStop,
  HiOutlineTrash,
  HiOutlineXMark,
  HiOutlineExclamationTriangle,
} from 'react-icons/hi2'
import LiveSurface from '@/components/gate/LiveSurface'
import DetectionFeed from '@/components/gate/DetectionFeed'
import { useGate } from '@/context/GateContext'
import useLaneReader from '@/hooks/useLaneReader'
import { bindSource, pushZone } from '@/lib/bridge'
import { PARK_NAME } from '@/data/registry'

/**
 * CameraPanel on the Gate Overview only ever binds cam-1, so the lane picked
 * here needs its own way to get a source — otherwise every camera but the first
 * is stuck with no picture. An rtsp:// address is registered with bridge.py;
 * an http:// one is used directly.
 */
function SourceBar({ camera }) {
  const { connectCamera, disconnectCamera } = useGate()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const typed = url.trim()
    if (!typed || busy) return
    setBusy(true)
    try {
      connectCamera(camera.id, await bindSource(camera.id, typed))
      setUrl('')
      setOpen(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const edit = () => {
    setUrl(camera.source ? camera.source.url : '')
    setOpen(true)
  }

  if (open) {
    return (
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
        <input
          suppressHydrationWarning
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="rtsp://admin:pass@192.168.1.65:554/Streaming/Channels/102"
          className="input flex-1 min-w-[240px] py-1 text-[11px]"
          aria-label="Camera address"
          autoFocus
        />
        <button
          suppressHydrationWarning
          type="submit"
          disabled={busy}
          className="px-3 py-1 rounded-md bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white text-[11px] font-medium transition-colors"
        >
          {busy ? 'Connecting…' : 'Save'}
        </button>
        <button
          suppressHydrationWarning
          type="button"
          onClick={() => setOpen(false)}
          className="px-2 py-1 text-slate-400 hover:text-slate-600 transition-colors"
        >
          Cancel
        </button>
      </form>
    )
  }

  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className="truncate">
        {camera.source
          ? `${camera.source.url}${camera.source.stream ? ' · via bridge' : ''}`
          : 'No source bound — bind a camera for the reader to work from'}
      </span>
      <button
        suppressHydrationWarning
        onClick={edit}
        className="text-primary-600 hover:text-primary-700 font-medium shrink-0 transition-colors"
      >
        {camera.source ? 'Change' : 'Add source'}
      </button>
      {camera.source && (
        <button
          suppressHydrationWarning
          onClick={() => disconnectCamera(camera.id)}
          className="text-slate-400 hover:text-red-600 shrink-0 transition-colors"
          aria-label="Remove camera source"
        >
          <HiOutlineXMark className="w-3.5 h-3.5" />
        </button>
      )}
    </span>
  )
}

export default function LiveViewPage() {
  const { cameras, events } = useGate()

  const [cameraId, setCameraId] = useState(cameras[0].id)
  const [running, setRunning] = useState(false)
  const [area, setArea] = useState(null)
  const [picking, setPicking] = useState(false)

  const camera = cameras.find((c) => c.id === cameraId) || cameras[0]
  const lane = camera.lane

  // The reads are real now: bridge.py runs the plates through OCR and the hook
  // polls for what it found, judges it against the allow-list and records it.
  const { latest, error: readerError } = useLaneReader(camera, running)

  // Reads are recorded in the shared log, so the feed lists that rather than a
  // second private copy — otherwise every pass would appear twice.
  const detections = useMemo(() => events.filter((e) => e.lane === lane), [events, lane])

  // The zone is drawn over the picture here but applied inside the reader, so
  // it has to travel. Clearing it sends null, which puts the whole frame back
  // in scope.
  useEffect(() => {
    if (!running) return
    pushZone(camera.id, area)
  }, [running, camera.id, area])

  // Switching cameras switches lanes, so the previous lane's reads are dropped.
  const selectCamera = (id) => {
    setCameraId(id)
    setArea(null)
    setPicking(false)
  }

  // Three states worth telling apart, because they need different actions from
  // whoever is watching: not started, reading, and reading-but-the-reader-is-
  // unreachable. The last one used to look exactly like the middle one.
  const pill = !running
    ? { text: 'Stopped', dot: 'bg-slate-400', cls: 'bg-slate-100 text-slate-500 border-slate-200' }
    : readerError
      ? { text: 'Reader down', dot: 'bg-red-500', cls: 'bg-red-50 text-red-700 border-red-200' }
      : { text: 'Reading', dot: 'bg-green-500', cls: 'bg-green-50 text-green-700 border-green-200' }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors shrink-0"
            aria-label="Back to gate overview"
          >
            <HiOutlineArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <select
              suppressHydrationWarning
              value={cameraId}
              onChange={(e) => selectCamera(e.target.value)}
              className="text-base font-bold text-slate-800 bg-transparent border-0 p-0 pr-6 focus:outline-none cursor-pointer"
              aria-label="Camera"
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="flex items-center gap-1 text-xs text-slate-400 mt-0.5 truncate">
              <HiOutlineMapPin className="w-3.5 h-3.5 shrink-0" />
              {PARK_NAME} · {camera.lane}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${pill.cls}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${pill.dot} ${running ? 'animate-pulse' : ''}`} />
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
            No plates are being read — {readerError}. The picture above, if there is one, is
            unaffected.
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <HiOutlineVideoCamera className="w-5 h-5 text-primary-600" />
                Live View
              </h3>
              <button
                suppressHydrationWarning
                onClick={() => setPicking((p) => !p)}
                className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${
                  picking
                    ? 'text-slate-500 hover:text-slate-700'
                    : 'text-primary-600 hover:text-primary-700'
                }`}
              >
                <HiOutlineViewfinderCircle className="w-4 h-4" />
                {picking ? 'Cancel' : 'Set detection area'}
              </button>
            </div>

            <LiveSurface
              camera={camera}
              running={running}
              latest={latest}
              area={area}
              picking={picking}
              onArea={setArea}
              onPickEnd={() => setPicking(false)}
            />

            <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-t border-slate-100 text-[11px] text-slate-400">
              <SourceBar camera={camera} />
              {area ? (
                <button
                  suppressHydrationWarning
                  onClick={() => setArea(null)}
                  className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600 transition-colors shrink-0"
                >
                  <HiOutlineTrash className="w-3.5 h-3.5" />
                  Clear zone
                </button>
              ) : (
                <span className="shrink-0">Whole frame scanned</span>
              )}
            </div>
          </div>
        </div>

        <DetectionFeed detections={detections} live={running} />
      </div>
    </div>
  )
}
