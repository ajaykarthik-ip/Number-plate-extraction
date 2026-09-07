'use client'

import { useEffect, useRef, useState } from 'react'
import {
  HiOutlineVideoCameraSlash,
  HiOutlineSignal,
  HiOutlineViewfinderCircle,
  HiOutlineExclamationTriangle,
  HiOutlineArrowPath,
} from 'react-icons/hi2'
import Plate from '@/components/common/Plate'
import { streamUrlOf, cameraHealth, healthProblem } from '@/lib/bridge'

// Often enough to catch a camera dropping mid-shift, rare enough that it costs
// nothing next to the stream itself.
const HEALTH_MS = 5000

/** Normalised (0..1) rect from two pointer positions inside the surface. */
function rectFrom(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

const asPercent = (r) => ({
  left: `${r.x * 100}%`,
  top: `${r.y * 100}%`,
  width: `${r.w * 100}%`,
  height: `${r.h * 100}%`,
})

/** True once a source has something an <img> can load — see @/lib/bridge. */
const streamOf = (camera) => streamUrlOf(camera.source)

/** An rtsp:// source only plays while bridge.py is up, so say so by name. */
const bridged = (camera) => Boolean(camera.source && camera.source.stream)

/**
 * The video surface. The picture, when there is one, is the camera's own MJPEG
 * stream; the plate reads drawn over it are still the scripted walk-through in
 * GateContext's sibling data file, because no ANPR service is running yet.
 */
export default function LiveSurface({
  camera,
  running,
  latest = null,
  area = null,
  picking = false,
  onArea = () => {},
  onPickEnd = () => {},
}) {
  const ref = useRef(null)
  const startRef = useRef(null)
  const [draft, setDraft] = useState(null)
  const [failed, setFailed] = useState(false)
  const [health, setHealth] = useState(null)
  // Bumped to re-request the stream. An <img> that has given up will not retry
  // on its own, and the same src would be served from cache, so the URL has to
  // differ each time.
  const [nonce, setNonce] = useState(0)

  const stream = streamOf(camera)
  const viaBridge = bridged(camera)

  // A new URL, or a restart, deserves a fresh attempt at the stream — so the
  // failure is dropped during the render that changes either one.
  const [attempt, setAttempt] = useState({ stream, running })
  if (attempt.stream !== stream || attempt.running !== running) {
    setAttempt({ stream, running })
    setFailed(false)
    setHealth(null)
  }

  // The picture cannot explain itself: a stream the browser never gets a byte
  // of looks the same as one that is simply dark. Ask the bridge instead, so a
  // dead pane comes with the reason rather than with silence.
  useEffect(() => {
    if (!running || !stream) return undefined
    let alive = true
    const probe = () => {
      cameraHealth(camera.id).then((next) => {
        if (alive) setHealth(next)
      })
    }
    probe()
    const id = setInterval(probe, HEALTH_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [running, stream, camera.id])

  const problem = healthProblem(health, { bridged: viaBridge })
  const src = stream && nonce ? `${stream}${stream.includes('?') ? '&' : '?'}r=${nonce}` : stream

  const retry = () => {
    setFailed(false)
    setNonce((n) => n + 1)
  }

  const showStream = running && stream && !failed && !problem

  const point = (e) => {
    const r = ref.current.getBoundingClientRect()
    const clamp = (v) => Math.min(Math.max(v, 0), 1)
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) }
  }

  const onPointerDown = (e) => {
    if (!picking) return
    e.currentTarget.setPointerCapture(e.pointerId)
    startRef.current = point(e)
    setDraft({ ...startRef.current, w: 0, h: 0 })
  }

  const onPointerMove = (e) => {
    if (!picking || !startRef.current) return
    setDraft(rectFrom(startRef.current, point(e)))
  }

  const onPointerUp = (e) => {
    if (!picking || !startRef.current) return
    const drawn = rectFrom(startRef.current, point(e))
    startRef.current = null
    setDraft(null)
    // A stray click is not a zone — a real one needs area to read plates in.
    onArea(drawn.w > 0.04 && drawn.h > 0.04 ? drawn : null)
    onPickEnd()
  }

  const zone = draft || area

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`relative aspect-video w-full overflow-hidden bg-[#101a35] select-none ${
        picking ? 'cursor-crosshair' : ''
      }`}
    >
      {/* Faint grid, so an empty surface still reads as a camera pane. */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* The stream itself. An MJPEG response never "finishes", so onLoad never
          fires — only onError tells us the URL is no good. */}
      {running && stream && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${camera.name} — ${camera.lane}`}
          onError={() => setFailed(true)}
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Keeps the plate overlay legible over a bright frame. */}
      {showStream && (
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-slate-950/80 to-transparent" />
      )}

      {running && (
        <span className="absolute left-0 right-0 top-0 h-px bg-primary-400/70 shadow-[0_0_12px_2px] shadow-primary-500/40 animate-scan" />
      )}

      {zone && (
        <div
          className="absolute border-2 border-dashed border-primary-400/80 bg-primary-500/10 rounded"
          style={asPercent(zone)}
        >
          <span className="absolute -top-6 left-0 px-1.5 py-0.5 rounded bg-primary-500/90 text-white text-[10px] font-medium whitespace-nowrap">
            Detection zone
          </span>
        </div>
      )}

      {picking && !draft && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/95 text-xs font-medium text-slate-700">
            <HiOutlineViewfinderCircle className="w-4 h-4 text-primary-600" />
            Drag a box over the lane the plates pass through
          </div>
        </div>
      )}

      {!running && !picking && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <HiOutlineVideoCameraSlash className="w-7 h-7 text-slate-400" />
          </div>
          <p className="mt-3 text-sm font-medium text-slate-200">Feed stopped</p>
          <p className="mt-1 text-xs text-slate-400 max-w-sm">
            {stream
              ? 'Press Start to pull the MJPEG stream from this camera.'
              : camera.source
                ? 'This source cannot be played by a browser. Bind an rtsp:// camera or an http:// MJPEG stream instead.'
                : 'No camera source bound to this lane yet. Add a source to see a picture, or press Start to walk through a recorded sequence.'}
          </p>
        </div>
      )}

      {/* Running, but there is no picture to show: wrong protocol, or none set. */}
      {running && !stream && !picking && (
        <div className="absolute inset-x-0 top-0 flex justify-center pt-4">
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950/70 backdrop-blur-sm text-[11px] text-slate-300 border border-white/10 max-w-[90%]">
            <HiOutlineExclamationTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">
              {camera.source
                ? 'This source cannot be decoded in a browser — reads are from the recorded sequence'
                : 'No video source bound — reads are from the recorded sequence'}
            </span>
          </span>
        </div>
      )}

      {running && stream && (failed || problem) && !picking && (
        <div className="absolute inset-x-0 top-0 flex justify-center pt-4 px-4">
          <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/15 backdrop-blur-sm text-[11px] text-red-200 border border-red-400/40 max-w-full">
            <HiOutlineExclamationTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {problem ||
                (viaBridge
                  ? 'Stream unreachable — is bridge.py still running?'
                  : `Stream unreachable — ${stream}`)}
            </span>
            <button
              suppressHydrationWarning
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-1 shrink-0 font-medium text-red-100 hover:text-white transition-colors"
            >
              <HiOutlineArrowPath className="w-3.5 h-3.5" />
              Retry
            </button>
          </span>
        </div>
      )}

      {running && !latest && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span
            className={`flex items-center gap-2 text-xs text-slate-300 ${
              showStream ? 'px-3 py-1.5 rounded-lg bg-slate-950/60 backdrop-blur-sm' : ''
            }`}
          >
            <HiOutlineSignal className="w-4 h-4 animate-pulse" />
            Waiting for a vehicle at {camera.lane}
          </span>
        </div>
      )}

      {/* Last read, drawn over the feed the way an ANPR overlay would be. */}
      {running && latest && (
        <div className="absolute left-4 bottom-4 right-4 flex items-end justify-between gap-3">
          <div className="animate-slide-up">
            <Plate value={latest.plate} size="lg" tone="dark" />
            <p className="mt-2 text-[11px] text-slate-300">
              {latest.type} · {latest.lane} · {Math.round(latest.confidence * 100)}% confidence
            </p>
          </div>
          <span
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border backdrop-blur-sm ${
              latest.decision === 'granted'
                ? 'bg-green-500/15 text-green-300 border-green-400/40'
                : 'bg-red-500/15 text-red-300 border-red-400/40'
            }`}
          >
            {latest.decision === 'granted' ? 'Barrier opened' : 'Barrier held'}
          </span>
        </div>
      )}

      {/* Corner brackets — cheap, and they frame the pane as a viewfinder. */}
      <span className="absolute left-3 top-3 w-6 h-6 border-l-2 border-t-2 border-white/25 rounded-tl" />
      <span className="absolute right-3 top-3 w-6 h-6 border-r-2 border-t-2 border-white/25 rounded-tr" />
      <span className="absolute left-3 bottom-3 w-6 h-6 border-l-2 border-b-2 border-white/25 rounded-bl" />
      <span className="absolute right-3 bottom-3 w-6 h-6 border-r-2 border-b-2 border-white/25 rounded-br" />
    </div>
  )
}
