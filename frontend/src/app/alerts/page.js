'use client'

import {
  HiOutlineShieldExclamation,
  HiOutlinePlusCircle,
  HiOutlineFlag,
  HiOutlineClock,
  HiOutlineFingerPrint,
} from 'react-icons/hi2'
import Plate from '@/components/common/Plate'
import Badge from '@/components/common/Badge'
import StatsCard from '@/components/common/StatsCard'
import { useGate } from '@/context/GateContext'

export default function AlertsPage() {
  const { alerts, stats, authorize, registry } = useGate()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Alerts</h1>
        <p className="text-sm text-slate-500 mt-1">
          Every vehicle stopped at the barrier because its plate is not on the park allow-list.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard
          icon={HiOutlineShieldExclamation}
          label="Blocked today"
          value={stats.denied}
          color="danger"
          subtitle="barrier held closed"
        />
        <StatsCard
          icon={HiOutlineFingerPrint}
          label="Unique plates"
          value={stats.unknownPlates.length}
          color="warning"
          subtitle="distinct unknown vehicles"
        />
        <StatsCard
          icon={HiOutlineFlag}
          label="On allow-list"
          value={registry.length}
          color="primary"
          subtitle="registered vehicles"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">Unregistered vehicle attempts</h3>
          <Badge variant="danger">{alerts.length} open</Badge>
        </div>

        <div className="divide-y divide-slate-100">
          {alerts.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-red-50/30 transition-colors"
            >
              <div className="p-2.5 rounded-xl bg-red-50 text-red-600 shrink-0">
                <HiOutlineShieldExclamation className="w-5 h-5" />
              </div>

              <div className="min-w-[150px]">
                <Plate value={a.plate} tone="denied" />
                <p className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1">
                  <HiOutlineClock className="w-3 h-3" />
                  {a.time} · {a.lane}
                </p>
              </div>

              <div className="flex-1 min-w-[200px]">
                <p className="text-sm text-slate-700 font-medium">Not on the tenant allow-list</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Plate read at {Math.round(a.confidence * 100)}% confidence · guard post notified ·
                  barrier held closed
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="danger">Blocked</Badge>
                <button
                  suppressHydrationWarning
                  onClick={() => authorize(a.plate)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  <HiOutlinePlusCircle className="w-4 h-4" />
                  Issue pass
                </button>
              </div>
            </div>
          ))}

          {alerts.length === 0 && (
            <div className="px-5 py-16 text-center">
              <HiOutlineShieldExclamation className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-500 font-medium">No blocked vehicles</p>
              <p className="text-xs text-slate-400 mt-1">
                {stats.total === 0
                  ? 'Nothing has reached the gate yet.'
                  : 'Everything that reached the gate today was on the allow-list.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
