'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

/**
 * The source video with the tracked boxes drawn over it.
 *
 * The overlay comes from boxes.json (per-frame boxes) rather than a re-encoded
 * annotated video: the browser plays the original H.264 file natively, seeking
 * stays instant, and labels always show the final voted plate for a track.
 */
const ResultPlayer = forwardRef(function ResultPlayer({ src, boxes, tracks }, ref) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const byId = useRef(new Map())
  const byPlate = useRef(new Map())

  useEffect(() => {
    // A plate can span several track ids (merged after a tracker break).
    byId.current = new Map(tracks.flatMap((t) => (t.ids || [t.id]).map((id) => [id, t])))
    byPlate.current = new Map(tracks.map((t) => [t.plate, t]))
  }, [tracks])

  useImperativeHandle(ref, () => ({
    seek(seconds) {
      const v = videoRef.current
      if (!v) return
      v.currentTime = Math.max(0, seconds)
      v.pause()
    },
  }))

  useEffect(() => {
    let raf
    const draw = () => {
      const v = videoRef.current
      const c = canvasRef.current
      if (v && c && boxes) {
        const w = c.clientWidth
        const h = c.clientHeight
        if (c.width !== w || c.height !== h) {
          c.width = w
          c.height = h
        }
        const ctx = c.getContext('2d')
        ctx.clearRect(0, 0, w, h)
        const frame = Math.floor(v.currentTime * boxes.fps + 0.001)
        const sx = w / boxes.width
        const sy = h / boxes.height
        ctx.font = '600 12px ui-monospace, monospace'
        for (const [key, x1, y1, x2, y2] of boxes.frames[frame] || []) {
          // Only confirmed plates carry a label; anything else is a thin grey
          // box so the tracking is visible without showing a guess. Rendered
          // runs store the plate text per box; tracked runs store the track id.
          const t =
            boxes.labels === 'plate' ? (key ? byPlate.current.get(key) : null) : byId.current.get(key)
          ctx.strokeStyle = t ? '#22c55e' : '#94a3b8'
          ctx.lineWidth = t ? 2 : 1
          ctx.strokeRect(x1 * sx, y1 * sy, (x2 - x1) * sx, (y2 - y1) * sy)
          if (!t) continue
          const color = '#22c55e'
          const label = t.display
          const tw = ctx.measureText(label).width + 8
          const ly = Math.max(y1 * sy - 18, 0)
          ctx.fillStyle = color
          ctx.fillRect(x1 * sx, ly, tw, 16)
          ctx.fillStyle = '#0f172a'
          ctx.fillText(label, x1 * sx + 4, ly + 12)
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [boxes])

  const ratio = boxes ? `${boxes.width} / ${boxes.height}` : '16 / 9'

  return (
    <div className="relative w-full bg-slate-900 rounded-lg overflow-hidden" style={{ aspectRatio: ratio }}>
      <video ref={videoRef} src={src} controls className="absolute inset-0 w-full h-full" />
      {/* pointer-events-none keeps the video controls under it clickable. */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
    </div>
  )
})

export default ResultPlayer
