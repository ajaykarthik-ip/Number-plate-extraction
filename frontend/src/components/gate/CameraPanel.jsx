'use client'

import { useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  HiOutlineVideoCameraSlash,
  HiOutlineLink,
  HiOutlineSignal,
  HiOutlineXMark,
  HiOutlineArrowTopRightOnSquare,
} from 'react-icons/hi2'
import LiveSurface from '@/components/gate/LiveSurface'
import { useGate } from '@/context/GateContext'
import { bindSource, streamUrlOf, BRIDGE_URL } from '@/lib/bridge'

/**
 * The gate camera tile. Paste the camera's own rtsp:// URL: bridge.py is asked
 * to open it and the http:// stream that comes back plays right here, on the
 * same surface Live View uses. An http:// MJPEG address is used as it is.
 */
export default function CameraPanel({ cameraId = 'cam-1' }) {
  const { cameras, connectCamera, disconnectCamera } = useGate()
  const camera = cameras.find((c) => c.id === cameraId) || cameras[0]

  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const connected = camera.status === 'configured'
  const playable = Boolean(streamUrlOf(camera.source))

  const submit = async (e) => {
    e.preventDefault()
    const typed = url.trim()
    if (!typed || busy) return
    setBusy(true)
    try {
      connectCamera(camera.id, await bindSource(camera.id, typed))
      setUrl('')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{camera.name}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{camera.lane}</p>
        </div>
        <div className="flex items-center gap-2">
          {playable && (
            <Link
              href="/live"
              className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors"
            >
              Live View
              <HiOutlineArrowTopRightOnSquare className="w-3.5 h-3.5" />
            </Link>
          )}
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border ${
              playable
                ? 'bg-green-50 text-green-700 border-green-200'
                : connected
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                playable ? 'bg-green-500 animate-pulse' : connected ? 'bg-amber-500' : 'bg-slate-400'
              }`}
            />
            {playable ? 'Streaming' : connected ? 'Source saved' : 'Not connected'}
          </span>
        </div>
      </div>

      {playable ? (
        <>
          <LiveSurface camera={camera} running />
          <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-t border-slate-100 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5 min-w-0">
              <HiOutlineSignal className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {camera.source.url}
                {camera.source.stream ? ' · via bridge' : ''}
              </span>
            </span>
            <button
              suppressHydrationWarning
              onClick={() => disconnectCamera(camera.id)}
              className="inline-flex items-center gap-1 text-slate-400 hover:text-red-600 transition-colors shrink-0"
            >
              <HiOutlineXMark className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <div className="p-5">
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
            <div className="inline-flex p-3 rounded-xl bg-white border border-slate-200">
              <HiOutlineVideoCameraSlash className="w-7 h-7 text-slate-400" />
            </div>
            <p className="mt-3 text-sm font-medium text-slate-700">
              {connected ? 'Source cannot be played here' : 'No camera connected'}
            </p>
            <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
              Paste the camera&apos;s <span className="plate">rtsp://</span> address below.{' '}
              <span className="plate">bridge.py</span> converts it to a picture a browser can show,
              so it has to be running — an <span className="plate">http://</span> MJPEG address
              needs no bridge and is used directly.
            </p>

            {connected && (
              <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 max-w-full">
                <HiOutlineSignal className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="plate text-[11px] text-slate-600 truncate">{camera.source.url}</span>
                <button
                  suppressHydrationWarning
                  onClick={() => disconnectCamera(camera.id)}
                  className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label="Remove camera source"
                >
                  <HiOutlineXMark className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <form onSubmit={submit} className="mt-4 flex flex-wrap gap-2">
            <input
              suppressHydrationWarning
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="rtsp://admin:pass@192.168.1.65:554/Streaming/Channels/102"
              className="input flex-1 min-w-[240px]"
              aria-label="Camera address"
            />
            <button
              suppressHydrationWarning
              type="submit"
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
            >
              <HiOutlineLink className="w-4 h-4" />
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </form>
          <p className="mt-2 text-[11px] text-slate-400">
            Bridge expected at <span className="plate">{BRIDGE_URL}</span>. Percent-encode specials
            in the password — <span className="plate">@</span> becomes{' '}
            <span className="plate">%40</span>.
          </p>
        </div>
      )}
    </div>
  )
}
