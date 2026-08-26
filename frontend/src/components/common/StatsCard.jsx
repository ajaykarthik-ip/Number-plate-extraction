'use client'

import { useEffect, useState } from 'react'

const colorMap = {
  primary: { bg: 'from-blue-50 to-blue-100/50',   border: 'border-blue-200',  icon: 'text-blue-600 bg-blue-100' },
  danger:  { bg: 'from-red-50 to-red-100/50',     border: 'border-red-200',   icon: 'text-red-600 bg-red-100' },
  warning: { bg: 'from-amber-50 to-amber-100/50', border: 'border-amber-200', icon: 'text-amber-600 bg-amber-100' },
  success: { bg: 'from-green-50 to-green-100/50', border: 'border-green-200', icon: 'text-green-600 bg-green-100' },
}

export default function StatsCard({ icon: Icon, label, value, color = 'primary', subtitle, suffix = '' }) {
  const isNumber = typeof value === 'number'
  const [display, setDisplay] = useState(0)

  // Count-up on mount and on every change, the same touch the PPE dashboard
  // uses — it makes a number that just moved obvious without a flash. Only
  // numbers animate; anything else is rendered straight through.
  useEffect(() => {
    if (!isNumber) return
    let start = 0
    const step = Math.max(1, Math.floor(value / 50))
    const timer = setInterval(() => {
      start += step
      if (start >= value) {
        setDisplay(value)
        clearInterval(timer)
      } else {
        setDisplay(start)
      }
    }, 16)
    return () => clearInterval(timer)
  }, [value, isNumber])

  const shown = isNumber ? display : value

  const c = colorMap[color] || colorMap.primary

  return (
    <div className={`bg-gradient-to-br ${c.bg} border ${c.border} rounded-xl p-5 shadow-sm animate-slide-up`}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</p>
          <p className="text-3xl font-bold text-slate-800 tabular-nums">
            {shown}
            {suffix}
          </p>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        <div className={`p-2.5 rounded-xl ${c.icon}`}>{Icon && <Icon className="w-6 h-6" />}</div>
      </div>
    </div>
  )
}
