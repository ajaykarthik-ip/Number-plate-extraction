'use client'

import { useState } from 'react'
import {
  HiOutlineVideoCameraSlash,
  HiOutlineLink,
  HiOutlineSignal,
  HiOutlineXMark,
} from 'react-icons/hi2'
import { useGate } from '@/context/GateContext'

const protocols = [
  { value: 'rtsp', label: 'RTSP', placeholder: 'rtsp://192.168.1.64:554/Streaming/Channels/101' },
  { value: 'http', label: 'HTTP / MJPEG', placeholder: 'http://192.168.1.64/video.mjpg' },
  { value: 'onvif', label: 'ONVIF / IP', placeholder: '192.168.1.64' },
]

/**
 * The gate camera tile. No ANPR service is running yet, so this is a
 * connection form rather than a video surface — saving a source records it and
 * nothing more. Swap the connected branch for the real <img>/<video> stream
 * once the backend can serve one.
 */
export default function CameraPanel({ cameraId = 'cam-1' }) {
  const { cameras, connectCamera, disconnectCamera } = useGate()
  const camera = cameras.find((c) => c.id === cameraId) || cameras[0]

  const [protocol, setProtocol] = useState('rtsp')
  const [url, setUrl] = useState('')

  const active = protocols.find((p) => p.value === protocol)
  const connected = camera.status === 'configured'

  const submit = (e) => {
    e.preventDefault()
    const value = url.trim()
    if (!value) return
    connectCamera(camera.id, { protocol, url: value })
    setUrl('')
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{camera.name}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{camera.lane}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border ${
            connected
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-slate-100 text-slate-500 border-slate-200'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-amber-500' : 'bg-slate-400'}`} />
          {connected ? 'Source saved' : 'Not connected'}
        </span>
      </div>

      <div className="p-5">
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
          <div className="inline-flex p-3 rounded-xl bg-white border border-slate-200">
            <HiOutlineVideoCameraSlash className="w-7 h-7 text-slate-400" />
          </div>
          <p className="mt-3 text-sm font-medium text-slate-700">
            {connected ? 'Stream not running' : 'No camera connected'}
          </p>
          <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
            {connected
              ? 'Source saved. The live view starts once the ANPR service is running against this camera.'
              : 'Add a camera source below. Movement history, the tenant allow-list and analytics are served from stored records in the meantime.'}
          </p>

          {connected && (
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 max-w-full">
              <HiOutlineSignal className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="plate text-[11px] text-slate-600 truncate">
                {camera.source.protocol.toUpperCase()} · {camera.source.url}
              </span>
              <button
                onClick={() => disconnectCamera(camera.id)}
                className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                aria-label="Remove camera source"
              >
                <HiOutlineXMark className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {!connected && (
          <form onSubmit={submit} className="mt-4 flex flex-wrap gap-2">
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className="input w-auto min-w-[140px]"
            >
              {protocols.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={active.placeholder}
              className="input flex-1 min-w-[220px]"
            />
            <button
              type="submit"
              className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
            >
              <HiOutlineLink className="w-4 h-4" />
              Connect
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
