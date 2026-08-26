'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  HiOutlineVideoCamera,
  HiOutlineChartBar,
  HiOutlineTruck,
  HiOutlineExclamationTriangle,
  HiOutlineDocumentText,
} from 'react-icons/hi2'
import { useGate } from '@/context/GateContext'

const navItems = [
  { href: '/',          label: 'Gate Overview',        icon: HiOutlineVideoCamera },
  { href: '/dashboard', label: 'Dashboard',        icon: HiOutlineChartBar },
  { href: '/vehicles',  label: 'Allowed Vehicles', icon: HiOutlineTruck },
  { href: '/alerts',    label: 'Alerts',           icon: HiOutlineExclamationTriangle },
  { href: '/logs',      label: 'Entry Log',        icon: HiOutlineDocumentText },
]

export default function Sidebar({ isOpen, onToggle }) {
  const pathname = usePathname()
  const { alerts } = useGate()

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-slate-900/20 z-20 lg:hidden" onClick={onToggle} />
      )}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-30 flex flex-col bg-white border-r border-slate-200 transition-all duration-300 ${
          isOpen ? 'w-64' : 'w-0 lg:w-20'
        } overflow-hidden`}
      >
        <div
          className={`flex items-center gap-3 bg-[#131d40] shrink-0 px-4 ${
            isOpen ? 'h-24' : 'h-16 justify-center px-0'
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
            <HiOutlineTruck className="w-6 h-6 text-white" />
          </div>
          {isOpen && (
            <div className="min-w-0">
              <p className="text-white font-semibold tracking-tight leading-tight">AutoGate NX</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                it park access control
              </p>
            </div>
          )}
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = pathname === item.href
            const showBadge = item.href === '/alerts' && alerts.length > 0
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  active
                    ? 'bg-primary-50 text-primary-700 border border-primary-200'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                }`}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                {isOpen && <span className="truncate flex-1">{item.label}</span>}
                {isOpen && showBadge && (
                  <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold tabular-nums">
                    {alerts.length}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 shrink-0">
          {isOpen && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-amber-500 shadow-lg shadow-amber-500/50 animate-pulse" />
              <span>Camera link pending</span>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
