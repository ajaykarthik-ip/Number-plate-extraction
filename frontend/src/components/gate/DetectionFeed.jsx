'use client'

import { useState } from 'react'
import {
  HiOutlineArrowRightOnRectangle,
  HiOutlineArrowLeftOnRectangle,
} from 'react-icons/hi2'
import { formatPlate } from '@/data/registry'

const filters = [
  { value: 'all',     label: 'All detections' },
  { value: 'granted', label: 'Allowed only' },
  { value: 'denied',  label: 'Blocked only' },
]

/**
 * The piece of frame the plate was read from.
 *
 * The reader keeps its crops and serves them by URL, so this is the actual
 * evidence for the row next to it — worth far more than a redrawing of the
 * text, because it shows whether a doubtful read came off a clear plate or a
 * smear. Reads made before crops existed, and any the bridge has since
 * forgotten, fall back to the plate itself.
 */
function Thumb({ plate, ok, crop }) {
  const [failed, setFailed] = useState(false)
  const border = ok ? 'border-green-500/40' : 'border-red-500/40'

  if (crop && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={crop}
        alt={`Capture of ${plate}`}
        onError={() => setFailed(true)}
        className={`w-11 h-11 rounded-md shrink-0 object-cover bg-[#101a35] border ${border}`}
      />
    )
  }

  return (
    <div
      className={`w-11 h-11 rounded-md shrink-0 flex flex-col items-center justify-center bg-[#101a35] border ${border}`}
    >
      <span className="plate text-[9px] leading-none text-white/90">{plate.slice(0, 4)}</span>
      <span className="plate text-[9px] leading-none text-white/60 mt-1">{plate.slice(4)}</span>
    </div>
  )
}

export default function DetectionFeed({ detections, live }) {
  const [filter, setFilter] = useState('all')
  const rows = detections.filter((d) => filter === 'all' || d.decision === filter)

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Recent detections</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {live ? 'Reading — newest first' : `${detections.length} on record`}
          </p>
        </div>
        <select
          suppressHydrationWarning
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="input w-auto py-1.5 text-xs"
          aria-label="Filter detections"
        >
          {filters.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div className="divide-y divide-slate-50 overflow-y-auto max-h-[560px]">
        {rows.map((d) => {
          const ok = d.decision === 'granted'
          const entering = d.direction !== 'out'
          return (
            <div
              key={d.id}
              className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/70 transition-colors"
            >
              <Thumb plate={d.plate} ok={ok} crop={d.crop} />
              <div className="min-w-0 flex-1">
                <p className="plate text-sm text-slate-800 truncate">{formatPlate(d.plate)}</p>
                <p className="flex items-center gap-1 text-[11px] text-slate-400 mt-1">
                  {entering ? (
                    <HiOutlineArrowRightOnRectangle className="w-3 h-3" />
                  ) : (
                    <HiOutlineArrowLeftOnRectangle className="w-3 h-3" />
                  )}
                  {d.time} · {entering ? 'In' : 'Out'} · {d.lane}
                  {typeof d.confidence === 'number' && (
                    <span className="tabular-nums">· {Math.round(d.confidence * 100)}%</span>
                  )}
                </p>
              </div>
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  ok ? 'bg-green-500' : 'bg-red-500'
                }`}
                title={ok ? 'Allowed' : 'Blocked'}
              />
            </div>
          )
        })}

        {rows.length === 0 && (
          <p className="px-5 py-10 text-center text-xs text-slate-400">
            {detections.length === 0
              ? live
                ? 'Reading the lane — the first plate the camera catches appears here.'
                : 'No reads on this lane yet. Press Start to begin reading.'
              : 'Nothing matches this filter.'}
          </p>
        )}
      </div>
    </div>
  )
}
