'use client'

import { useMemo, useState } from 'react'
import {
  HiOutlineMagnifyingGlass,
  HiOutlineArrowDownTray,
  HiOutlineArrowRightOnRectangle,
  HiOutlineArrowLeftOnRectangle,
} from 'react-icons/hi2'
import Plate from '@/components/common/Plate'
import Badge from '@/components/common/Badge'
import { useGate } from '@/context/GateContext'

const decisionFilters = ['All', 'Allowed', 'Blocked']
const directionFilters = ['All', 'In', 'Out']

export default function LogsPage() {
  const { events, registry } = useGate()
  const [query, setQuery] = useState('')
  const [decision, setDecision] = useState('All')
  const [direction, setDirection] = useState('All')

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase().replace(/\s/g, '')
    return events.filter((e) => {
      const matchesQuery = !q || e.plate.includes(q)
      const matchesDecision =
        decision === 'All' ||
        (decision === 'Allowed' && e.decision === 'granted') ||
        (decision === 'Blocked' && e.decision === 'denied')
      const matchesDirection =
        direction === 'All' ||
        (direction === 'In' && e.direction !== 'out') ||
        (direction === 'Out' && e.direction === 'out')
      return matchesQuery && matchesDecision && matchesDirection
    })
  }, [events, query, decision, direction])

  // The log stores plates; the tenant comes from whatever the allow-list says
  // about that plate right now.
  const tenantFor = (plate) => registry.find((v) => v.plate === plate)?.tenant || '—'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Entry Log</h1>
          <p className="text-sm text-slate-500 mt-1">
            Complete in/out history for the park, newest first.
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg border border-slate-200 transition-colors">
          <HiOutlineArrowDownTray className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="relative flex-1 min-w-[220px]">
            <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a number plate"
              className="input pl-9"
            />
          </div>

          <FilterGroup options={decisionFilters} value={decision} onChange={setDecision} />
          <FilterGroup options={directionFilters} value={direction} onChange={setDirection} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 bg-slate-50/70">
                <th className="px-5 py-3 font-medium">Time</th>
                <th className="px-5 py-3 font-medium">Plate</th>
                <th className="px-5 py-3 font-medium">Direction</th>
                <th className="px-5 py-3 font-medium">Lane</th>
                <th className="px-5 py-3 font-medium">Tenant</th>
                <th className="px-5 py-3 font-medium">Match</th>
                <th className="px-5 py-3 font-medium text-right">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((e) => {
                const ok = e.decision === 'granted'
                const entering = e.direction !== 'out'
                return (
                  <tr key={e.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3 plate text-xs text-slate-600">{e.time}</td>
                    <td className="px-5 py-3">
                      <Plate value={e.plate} size="sm" tone={ok ? 'light' : 'denied'} />
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium ${
                          entering ? 'text-blue-600' : 'text-violet-600'
                        }`}
                      >
                        {entering ? (
                          <HiOutlineArrowRightOnRectangle className="w-4 h-4" />
                        ) : (
                          <HiOutlineArrowLeftOnRectangle className="w-4 h-4" />
                        )}
                        {entering ? 'In' : 'Out'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{e.lane}</td>
                    <td className="px-5 py-3 text-slate-500 truncate max-w-[220px]">
                      {tenantFor(e.plate)}
                    </td>
                    <td className="px-5 py-3 text-slate-600 tabular-nums">
                      {Math.round(e.confidence * 100)}%
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Badge variant={ok ? 'success' : 'danger'}>{ok ? 'Allowed' : 'Blocked'}</Badge>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400">
                    No movements match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400">
          Showing {rows.length} of {events.length} movements
        </div>
      </div>
    </div>
  )
}

function FilterGroup({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            value === o
              ? 'bg-primary-50 text-primary-700 border-primary-200'
              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}
