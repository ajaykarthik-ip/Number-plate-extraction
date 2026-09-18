'use client'

import {
  HiOutlineCheckCircle,
  HiOutlineXCircle,
  HiOutlineLockClosed,
  HiOutlineShieldCheck,
  HiOutlinePauseCircle,
} from 'react-icons/hi2'
import Plate from '@/components/common/Plate'
import Badge from '@/components/common/Badge'

// What each barrier state looks like and, more usefully, what it means. The
// signal is raised by this screen and nothing else: no barrier controller is
// wired up yet, so "Open" means the gate was cleared to open, not that an arm
// has moved. Saying otherwise on a demo screen would be a lie an operator
// could act on.
const states = {
  idle: {
    icon: HiOutlinePauseCircle,
    title: 'Gate idle',
    note: 'The reader is stopped — nothing is being judged at this lane.',
    frame: 'border-slate-200 bg-slate-50',
    chip: 'bg-slate-200 text-slate-600',
  },
  armed: {
    icon: HiOutlineShieldCheck,
    title: 'Armed',
    note: 'Waiting for a vehicle. The next plate read decides the barrier.',
    frame: 'border-primary-200 bg-primary-50',
    chip: 'bg-primary-600 text-white',
  },
  open: {
    icon: HiOutlineCheckCircle,
    title: 'Barrier open',
    note: 'Plate is on the allow-list — cleared to enter.',
    frame: 'border-green-300 bg-green-50',
    chip: 'bg-green-600 text-white',
  },
  held: {
    icon: HiOutlineLockClosed,
    title: 'Barrier held',
    note: 'Plate is not on the allow-list. Issue a pass or turn the vehicle away.',
    frame: 'border-red-300 bg-red-50',
    chip: 'bg-red-600 text-white',
  },
}

/**
 * The decision at the barrier, as the person in the gatehouse needs it: what
 * the camera just read, whether it may come in, and the one action left to
 * take when it may not.
 */
export default function BarrierPanel({ state, verdict, vehicle, onIssuePass }) {
  const s = states[state] || states.idle
  const Icon = s.icon
  const denied = verdict && verdict.decision === 'denied'

  return (
    <div className={`rounded-xl border-2 ${s.frame} p-5 shadow-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`p-2 rounded-xl shrink-0 ${s.chip}`}>
            <Icon className="w-6 h-6" />
          </span>
          <div className="min-w-0">
            <p className="text-lg font-bold text-slate-800 leading-tight">{s.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.note}</p>
          </div>
        </div>
        {state === 'open' && (
          <span className="shrink-0 w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse mt-2" />
        )}
      </div>

      {verdict ? (
        <div className="mt-5 pt-5 border-t border-slate-900/5">
          <div className="flex flex-wrap items-center gap-3">
            <Plate value={verdict.plate} size="lg" tone={denied ? 'denied' : 'granted'} />
            <Badge variant={denied ? 'danger' : 'success'}>
              {denied ? (
                <HiOutlineXCircle className="w-3.5 h-3.5" />
              ) : (
                <HiOutlineCheckCircle className="w-3.5 h-3.5" />
              )}
              {denied ? 'Not registered' : 'Registered'}
            </Badge>
          </div>

          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-xs">
            <div>
              <dt className="text-slate-400">Read at</dt>
              <dd className="plate text-slate-700 mt-0.5">{verdict.time}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Confidence</dt>
              <dd className="text-slate-700 mt-0.5 tabular-nums">
                {typeof verdict.confidence === 'number'
                  ? `${Math.round(verdict.confidence * 100)}%`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Owner</dt>
              <dd className="text-slate-700 mt-0.5 truncate">{vehicle ? vehicle.owner : '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Tenant</dt>
              <dd className="text-slate-700 mt-0.5 truncate">{vehicle ? vehicle.tenant : '—'}</dd>
            </div>
          </dl>

          {denied &&
            (vehicle ? (
              // Authorised after the fact. The row already logged stays
              // "Blocked" — that is the audit record — but the next read of
              // this plate clears the barrier on its own.
              <p className="mt-4 text-xs text-green-700">
                Added to the allow-list. The next read of this plate opens the barrier; the
                blocked entry above stays in the log.
              </p>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  suppressHydrationWarning
                  onClick={onIssuePass}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
                >
                  <HiOutlineCheckCircle className="w-4 h-4" />
                  Issue visitor pass
                </button>
                <span className="text-[11px] text-slate-500">
                  Adds the plate to the allow-list for this session.
                </span>
              </div>
            ))}
        </div>
      ) : (
        <p className="mt-5 pt-5 border-t border-slate-900/5 text-xs text-slate-400">
          No plate read on this lane yet. The first vehicle the camera catches appears here with
          its decision.
        </p>
      )}
    </div>
  )
}
