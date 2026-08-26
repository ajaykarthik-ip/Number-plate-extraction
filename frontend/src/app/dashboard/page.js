'use client'

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  HiOutlineArrowRightOnRectangle,
  HiOutlineArrowLeftOnRectangle,
  HiOutlineShieldExclamation,
  HiOutlineSparkles,
} from 'react-icons/hi2'
import StatsCard from '@/components/common/StatsCard'
import Badge from '@/components/common/Badge'
import { useGate } from '@/context/GateContext'
import { hourlyFlow, weeklyTrend, categorySplit, blockOccupancy } from '@/data/registry'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
)

const gridColor = 'rgba(148, 163, 184, 0.18)'
const tickColor = '#94a3b8'

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle', color: '#64748b', font: { size: 11 } },
    },
    tooltip: {
      backgroundColor: '#0f172a',
      padding: 10,
      cornerRadius: 8,
      titleFont: { size: 12 },
      bodyFont: { size: 12 },
    },
  },
  scales: {
    x: { grid: { display: false }, ticks: { color: tickColor, font: { size: 11 } } },
    y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 11 } }, beginAtZero: true },
  },
}

export default function DashboardPage() {
  const { stats } = useGate()

  const flowData = {
    labels: hourlyFlow.map((h) => h.hour),
    datasets: [
      {
        label: 'Entries',
        data: hourlyFlow.map((h) => h.inCount),
        backgroundColor: '#2563eb',
        borderRadius: 4,
        barPercentage: 0.7,
      },
      {
        label: 'Exits',
        data: hourlyFlow.map((h) => h.outCount),
        backgroundColor: '#a5b4fc',
        borderRadius: 4,
        barPercentage: 0.7,
      },
    ],
  }

  const trendData = {
    labels: weeklyTrend.map((d) => d.day),
    datasets: [
      {
        label: 'Total movements',
        data: weeklyTrend.map((d) => d.total),
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.12)',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: '#2563eb',
      },
      {
        label: 'Blocked',
        data: weeklyTrend.map((d) => d.denied),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.10)',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: '#ef4444',
      },
    ],
  }

  const categoryData = {
    labels: categorySplit.map((c) => c.label),
    datasets: [
      {
        data: categorySplit.map((c) => c.value),
        backgroundColor: ['#2563eb', '#60a5fa', '#f59e0b', '#22c55e', '#a78bfa'],
        borderWidth: 0,
        hoverOffset: 6,
      },
    ],
  }

  const donutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: baseOptions.plugins,
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          Traffic, occupancy and access outcomes across the park.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatsCard icon={HiOutlineArrowRightOnRectangle} label="Entries today" value={stats.entries} color="primary" subtitle="all gates" />
        <StatsCard icon={HiOutlineArrowLeftOnRectangle} label="Exits today" value={stats.exits} color="success" subtitle="all gates" />
        <StatsCard icon={HiOutlineShieldExclamation} label="Blocked attempts" value={stats.denied} color="danger" subtitle="unregistered plates" />
        <StatsCard icon={HiOutlineSparkles} label="Plate read accuracy" value={stats.accuracy} suffix="%" color="warning" subtitle="average match score" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">In / out flow by hour</h3>
              <p className="text-xs text-slate-400 mt-0.5">Today, all lanes</p>
            </div>
            <Badge variant="info">Live</Badge>
          </div>
          <div className="h-72">
            <Bar data={flowData} options={baseOptions} />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Traffic by pass type</h3>
          <p className="text-xs text-slate-400 mb-4">Share of today movements</p>
          <div className="h-72">
            <Doughnut data={categoryData} options={donutOptions} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">This week</h3>
          <p className="text-xs text-slate-400 mb-4">Total movements against blocked attempts</p>
          <div className="h-64">
            <Line data={trendData} options={baseOptions} />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Parking occupancy</h3>
          <p className="text-xs text-slate-400 mb-4">Bays taken per block</p>
          <div className="space-y-4">
            {blockOccupancy.map((b) => {
              const pct = Math.round((b.inside / b.capacity) * 100)
              const tone = pct > 85 ? 'bg-red-500' : pct > 65 ? 'bg-amber-500' : 'bg-primary-600'
              return (
                <div key={b.block}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-slate-600 truncate pr-2">{b.block}</span>
                    <span className="text-slate-400 tabular-nums shrink-0">
                      {b.inside}/{b.capacity}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full rounded-full ${tone} transition-all duration-700`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
