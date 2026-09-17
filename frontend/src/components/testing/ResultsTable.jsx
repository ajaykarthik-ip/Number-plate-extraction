'use client'

import Badge from '@/components/common/Badge'
import { fileUrl } from '@/lib/testing'

const VERDICT = {
  correct: ['success', 'Correct'],
  wrong: ['danger', 'Wrong'],
  unverifiable: ['neutral', "Can't verify"],
}

const fmtTime = (s) => {
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}

/**
 * Confirmed plates only — the server never sends a plate that failed the format
 * check or lacked agreeing reads. Clicking a row seeks the player to it.
 */
export default function ResultsTable({ jobId, tracks, done, compare, verdicts, onSeek, activeId }) {
  const checked = Boolean(verdicts)
  const columns = 5 + (compare ? 3 : 0) + (checked ? 1 : 0)
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800">Valid plates</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          {tracks.length} confirmed · {done ? 'final' : 'updating while the video is read'}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 bg-slate-50/70">
              <th className="px-5 py-3 font-medium">Crop</th>
              <th className="px-5 py-3 font-medium">Plate</th>
              {compare && <th className="px-5 py-3 font-medium">Plate model</th>}
              {compare && <th className="px-5 py-3 font-medium">EasyOCR</th>}
              {compare && <th className="px-5 py-3 font-medium">Tesseract</th>}
              <th className="px-5 py-3 font-medium">Confidence</th>
              <th className="px-5 py-3 font-medium">Votes</th>
              <th className="px-5 py-3 font-medium">Seen</th>
              {checked && <th className="px-5 py-3 font-medium text-right">Check</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tracks.map((t) => (
              <tr
                key={t.plate}
                onClick={() => onSeek?.(t)}
                className={`${onSeek ? 'cursor-pointer' : ''} transition-colors ${
                  activeId === t.id ? 'bg-primary-50/60' : 'hover:bg-slate-50/70'
                }`}
              >
                <td className="px-5 py-3">
                  {done && t.crop ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fileUrl(jobId, t.crop)}
                      alt={`crop of ${t.display}`}
                      className="h-8 max-w-[120px] object-contain rounded border border-slate-200 bg-slate-900"
                    />
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <span className="plate inline-block rounded-md border-2 text-xs px-2 py-0.5 bg-amber-50 border-amber-300 text-slate-900">
                    {t.display}
                  </span>
                  {t.merged_misreads && Object.keys(t.merged_misreads).length > 0 && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      corrected: {Object.entries(t.merged_misreads).map(([p, n]) => `${p} ×${n}`).join(', ')}
                    </p>
                  )}
                </td>
                {compare && <EngineCell r={t.by_engine?.plate} />}
                {compare && <EngineCell r={t.by_engine?.easyocr} />}
                {compare && <EngineCell r={t.by_engine?.tesseract} />}
                <td className="px-5 py-3 text-slate-600 tabular-nums">{Math.round(t.confidence * 100)}%</td>
                <td className="px-5 py-3 text-slate-600 tabular-nums">{t.votes}</td>
                <td className="px-5 py-3 text-xs text-slate-500 tabular-nums">
                  {fmtTime(t.first_seconds)}–{fmtTime(t.last_seconds)}
                </td>
                {checked && (
                  <td className="px-5 py-3 text-right">
                    <Verdict v={verdicts[t.plate]} />
                  </td>
                )}
              </tr>
            ))}
            {tracks.length === 0 && (
              <tr>
                <td colSpan={columns} className="px-5 py-10 text-center text-sm text-slate-400">
                  {done ? 'No valid plate was confirmed in this video.' : 'No valid plate confirmed yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Verdict({ v }) {
  if (!v) return <span className="text-xs text-slate-300">—</span>
  const [variant, label] = VERDICT[v.verdict] || VERDICT.unverifiable
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Badge variant={variant}>{label}</Badge>
      {v.verdict === 'wrong' && v.real && <span className="plate text-[11px] text-slate-500">real: {v.real}</span>}
    </span>
  )
}

function EngineCell({ r }) {
  if (!r) return <td className="px-5 py-3 text-xs text-slate-300">—</td>
  return (
    <td className="px-5 py-3">
      <span className="plate text-xs text-slate-800">{r.plate}</span>
      <span className="ml-2 text-[11px] text-slate-400 tabular-nums">
        {Math.round(r.confidence * 100)}% · {r.votes}
      </span>
    </td>
  )
}
