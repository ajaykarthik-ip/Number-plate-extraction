'use client'

import Link from 'next/link'
import { HiOutlineBars3, HiOutlineBell, HiOutlineVideoCamera } from 'react-icons/hi2'
import { useGate } from '@/context/GateContext'
import { GATE_NAME, PARK_NAME } from '@/data/registry'

export default function Navbar({ onMenuToggle }) {
  const { alerts, cameras, camerasConnected } = useGate()

  return (
    <header className="h-16 bg-white/90 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-4 lg:px-6 shrink-0 z-10">
      <div className="flex items-center gap-3">
        <button
          suppressHydrationWarning
          onClick={onMenuToggle}
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
          aria-label="Toggle navigation"
        >
          <HiOutlineBars3 className="w-5 h-5 text-slate-600" />
        </button>
        <div className="hidden sm:block">
          <p className="text-sm font-semibold text-slate-800 leading-tight">{GATE_NAME}</p>
          <p className="text-[11px] text-slate-400">{PARK_NAME}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span
          className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border ${
            camerasConnected
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-slate-100 text-slate-500 border-slate-200'
          }`}
        >
          <HiOutlineVideoCamera className="w-4 h-4" />
          {camerasConnected
            ? `${camerasConnected}/${cameras.length} cameras configured`
            : 'No camera connected'}
        </span>

        <Link href="/alerts" className="relative p-2 rounded-lg hover:bg-slate-100 transition-colors">
          <HiOutlineBell className="w-5 h-5 text-slate-600" />
          {alerts.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {alerts.length > 9 ? '9+' : alerts.length}
            </span>
          )}
        </Link>

        <div className="flex items-center gap-3 pl-3 pr-1 py-1.5 border-l border-slate-200">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-slate-700">Dhivya</p>
            <p className="text-[10px] text-slate-400 uppercase">Security Admin</p>
          </div>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
            <span className="text-sm font-bold text-white">D</span>
          </div>
        </div>
      </div>
    </header>
  )
}
