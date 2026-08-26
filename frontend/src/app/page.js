'use client'

import {
  HiOutlineBuildingOffice2,
  HiOutlineArrowRightOnRectangle,
  HiOutlineArrowLeftOnRectangle,
  HiOutlineExclamationTriangle,
  HiOutlineVideoCamera,
} from 'react-icons/hi2'
import CameraPanel from '@/components/gate/CameraPanel'
import RecentPasses from '@/components/gate/RecentPasses'
import StatsCard from '@/components/common/StatsCard'
import { useGate } from '@/context/GateContext'

export default function LiveGatePage() {
  const { stats, cameras } = useGate()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Gate Overview</h1>
        <p className="text-sm text-slate-500 mt-1">
          Every plate entering or leaving the park is matched against the tenant allow-list.
          Unknown vehicles never get the barrier.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatsCard
          icon={HiOutlineBuildingOffice2}
          label="Inside now"
          value={stats.inside}
          color="primary"
          subtitle="vehicles on campus"
        />
        <StatsCard
          icon={HiOutlineArrowRightOnRectangle}
          label="Entries today"
          value={stats.entries}
          color="success"
          subtitle="barrier opened"
        />
        <StatsCard
          icon={HiOutlineArrowLeftOnRectangle}
          label="Exits today"
          value={stats.exits}
          color="warning"
          subtitle="cleared the gate"
        />
        <StatsCard
          icon={HiOutlineExclamationTriangle}
          label="Blocked"
          value={stats.denied}
          color="danger"
          subtitle="not on allow-list"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-4">
          <CameraPanel />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {cameras.map((cam) => {
              const configured = cam.status === 'configured'
              const online = cam.status === 'online'
              return (
                <div key={cam.id} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        online
                          ? 'bg-green-500 shadow-lg shadow-green-500/50'
                          : configured
                            ? 'bg-amber-400'
                            : 'bg-slate-300'
                      }`}
                    />
                    <HiOutlineVideoCamera className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[11px] font-medium text-slate-700 truncate">
                      {cam.name}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5 truncate">
                    {cam.lane} ·{' '}
                    {online ? `${cam.fps} fps` : configured ? 'source saved' : 'not connected'}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-4">
          <RecentPasses limit={10} />
        </div>
      </div>
    </div>
  )
}
