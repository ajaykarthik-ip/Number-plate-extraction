'use client'

import {
  HiOutlineCheckCircle,
  HiOutlineXCircle,
  HiOutlineArrowRightOnRectangle,
  HiOutlineArrowLeftOnRectangle,
} from 'react-icons/hi2'
import Plate from '@/components/common/Plate'
import { useGate } from '@/context/GateContext'

export default function RecentPasses({ limit = 8 }) {
  const { events } = useGate()

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-800">Recent movements</h3>
        <span className="text-xs text-slate-400">{events.length} today</span>
      </div>
      <div className="divide-y divide-slate-50 max-h-[420px] overflow-y-auto">
        {events.slice(0, limit).map((e) => {
          const ok = e.decision === 'granted'
          const entering = e.direction !== 'out'
          return (
            <div
              key={e.id}
              className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/70 transition-colors"
            >
              <div className={`p-1.5 rounded-lg ${ok ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                {ok ? <HiOutlineCheckCircle className="w-5 h-5" /> : <HiOutlineXCircle className="w-5 h-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <Plate value={e.plate} size="sm" tone={ok ? 'granted' : 'denied'} />
                <p className="flex items-center gap-1 text-[11px] text-slate-400 mt-1">
                  {entering ? (
                    <HiOutlineArrowRightOnRectangle className="w-3 h-3" />
                  ) : (
                    <HiOutlineArrowLeftOnRectangle className="w-3 h-3" />
                  )}
                  {entering ? 'In' : 'Out'} · {e.lane}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="plate text-xs text-slate-600">{e.time}</p>
                <p className={`text-[11px] font-medium ${ok ? 'text-green-600' : 'text-red-600'}`}>
                  {ok ? 'Allowed' : 'Blocked'}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
