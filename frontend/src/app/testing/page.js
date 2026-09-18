'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  HiOutlineArrowDownTray,
  HiOutlineBeaker,
  HiOutlineCpuChip,
  HiOutlineExclamationTriangle,
  HiOutlineStop,
} from 'react-icons/hi2'
import Badge from '@/components/common/Badge'
import RunPanel from '@/components/testing/RunPanel'
import ResultsTable from '@/components/testing/ResultsTable'
import ResultPlayer from '@/components/testing/ResultPlayer'
import {
  TEST_URL,
  cancelJob,
  fetchBoxes,
  fileUrl,
  getJob,
  listJobs,
  previewUrl,
  runSample,
  serverHealth,
  uploadVideo,
  videoUrl,
} from '@/lib/testing'

const POLL_MS = 1000
const LAST_JOB_KEY = 'autogate.testing.lastJob'

const ACTIVE = new Set(['queued', 'running'])

const statusBadge = {
  queued: ['info', 'Queued'],
  running: ['info', 'Reading'],
  done: ['success', 'Done'],
  cancelled: ['warning', 'Cancelled'],
  error: ['danger', 'Failed'],
}

export default function TestingPage() {
  const [health, setHealth] = useState(null)
  const [healthError, setHealthError] = useState(null)
  const [job, setJob] = useState(null)
  const [jobs, setJobs] = useState([])
  const [boxes, setBoxes] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [activeTrack, setActiveTrack] = useState(null)
  const playerRef = useRef(null)

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await serverHealth())
      setHealthError(null)
      setJobs(await listJobs())
    } catch (err) {
      setHealth(null)
      setHealthError(err.message)
    }
  }, [])

  // Server status on mount, and reopen the last run if the server still has it.
  useEffect(() => {
    refreshHealth()
    let last = null
    try {
      last = localStorage.getItem(LAST_JOB_KEY)
    } catch {}
    if (last) getJob(last).then(setJob).catch(() => {})
    const t = setInterval(refreshHealth, 10000)
    return () => clearInterval(t)
  }, [refreshHealth])

  const jobId = job?.id
  const jobStatus = job?.status

  // Poll the job while it is being read.
  useEffect(() => {
    if (!jobId || !ACTIVE.has(jobStatus)) return
    const t = setInterval(async () => {
      try {
        const next = await getJob(jobId)
        setJob(next)
        if (!ACTIVE.has(next.status)) refreshHealth()
      } catch (err) {
        setHealthError(err.message)
      }
    }, POLL_MS)
    return () => clearInterval(t)
  }, [jobId, jobStatus, refreshHealth])

  // Overlay boxes once the run has finished.
  useEffect(() => {
    setBoxes(null)
    if (!jobId || ACTIVE.has(jobStatus) || jobStatus === 'error') return
    fetchBoxes(jobId).then(setBoxes)
  }, [jobId, jobStatus])

  const open = (next) => {
    setJob(next)
    setActiveTrack(null)
    try {
      localStorage.setItem(LAST_JOB_KEY, next.id)
    } catch {}
  }

  const start = async (runner) => {
    setUploading(true)
    try {
      open(await runner())
      refreshHealth()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setUploading(false)
    }
  }

  const seek = (track) => {
    setActiveTrack(track.id)
    playerRef.current?.seek(track.first_seconds)
  }

  const running = job && ACTIVE.has(job.status)
  const finished = job && (job.status === 'done' || job.status === 'cancelled')
  const progress = job?.progress?.total ? job.progress.frame / job.progress.total : 0
  const compare = job?.settings?.ocr === 'all'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <HiOutlineBeaker className="w-6 h-6 text-primary-600" />
            Testing
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Run a recorded video through YOLO plate tracking and OCR. Separate from the live gate —
            nothing here touches the allow-list or the entry log.
          </p>
        </div>
        <ServerStatus health={health} />
      </div>

      {healthError && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
          <HiOutlineExclamationTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <span className="plate font-normal tracking-normal text-xs leading-5">{healthError}</span>
        </div>
      )}
      {health && !health.model_found && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          <HiOutlineExclamationTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>
            YOLO weights <b>{health.model}</b> are missing from <code>testing/models/</code> — see
            testing/README.md.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="space-y-6">
          <RunPanel
            health={health}
            busy={uploading || running}
            onUpload={(file, s) => start(() => uploadVideo(file, s))}
            onSample={(s) => start(() => runSample(s))}
          />
          <RecentRuns jobs={jobs} currentId={job?.id} onOpen={(id) => getJob(id).then(open).catch(() => {})} />
        </div>

        <div className="xl:col-span-2 space-y-6">
          {!job && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-16 text-center text-sm text-slate-400">
              {uploading ? 'Uploading video…' : 'Choose a video and start a run — the annotated picture shows here.'}
            </div>
          )}

          {job && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{job.filename}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {job.settings.ocr} · {job.settings.region.toUpperCase()} ·{' '}
                    {job.settings.sample_fps ? `${job.settings.sample_fps} frames/s` : 'every frame'} · min{' '}
                    {Math.round(job.settings.min_conf * 100)}%
                    {job.results && ` · ${job.results.seconds}s on ${job.results.device === 'cpu' ? 'CPU' : 'GPU'}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusBadge[job.status]?.[0]}>{statusBadge[job.status]?.[1]}</Badge>
                  {running && (
                    <button
                      onClick={() => cancelJob(job.id).catch((e) => toast.error(e.message))}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg"
                    >
                      <HiOutlineStop className="w-4 h-4" />
                      Stop
                    </button>
                  )}
                  {finished && (
                    <>
                      <Download href={fileUrl(job.id, 'results.csv')} label="CSV" />
                      <Download href={fileUrl(job.id, 'annotated.mp4')} label="Annotated video" />
                    </>
                  )}
                </div>
              </div>

              {running && (
                <>
                  <div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-primary-500 transition-all duration-500"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
                      {job.status === 'queued'
                        ? 'Waiting for the previous run to finish…'
                        : job.progress.stage === 'video'
                          ? `Step 2 of 2 · drawing plates on every frame · frame ${job.progress.frame} of ${job.progress.total}`
                          : `${job.settings.sample_fps ? 'Step 1 of 2 · ' : ''}reading plates · frame ${job.progress.frame} of ${job.progress.total} · ${job.progress.fps} fps`}
                    </p>
                  </div>
                  {job.status === 'running' && (
                    <div className="bg-slate-900 rounded-lg overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previewUrl(job.id)} alt="annotated frames as they are read" className="w-full" />
                    </div>
                  )}
                </>
              )}

              {job.status === 'error' && (
                <p className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">{job.error}</p>
              )}

              {finished && (
                <ResultPlayer ref={playerRef} src={videoUrl(job.id)} boxes={boxes} tracks={job.tracks || []} />
              )}

              {finished && job.results?.evaluation && <Accuracy evaluation={job.results.evaluation} />}

              {job.results?.engine_errors && Object.keys(job.results.engine_errors).length > 0 && (
                <p className="text-xs text-amber-700">
                  Skipped:{' '}
                  {Object.entries(job.results.engine_errors)
                    .map(([k, v]) => `${k} — ${v}`)
                    .join('; ')}
                </p>
              )}
            </div>
          )}

          {job && job.status !== 'error' && (
            <ResultsTable
              jobId={job.id}
              tracks={job.tracks || []}
              done={finished}
              compare={compare}
              verdicts={job.results?.evaluation?.verdicts}
              onSeek={finished ? seek : undefined}
              activeId={activeTrack}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** How the run scored against the video's answer key (testing/ground_truth/). */
function Accuracy({ evaluation: e }) {
  const pct = (v) => `${Math.round(v * 100)}%`
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">Accuracy check</p>
        <p className="text-[11px] text-slate-400">answer key: {e.truth_file}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Captured" value={`${e.captured} / ${e.truth_count}`} tone="text-green-700" />
        <Stat label="Recall" value={pct(e.recall)} tone="text-slate-800" />
        <Stat label="Wrong plates" value={e.wrong} tone={e.wrong ? 'text-red-600' : 'text-slate-800'} />
        <Stat label="Precision" value={pct(e.precision)} tone="text-slate-800" />
      </div>
      {e.missed.length > 0 && (
        <p className="text-xs text-slate-500">
          Missed: <span className="plate text-slate-700">{e.missed.join(', ')}</span>
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  )
}

function ServerStatus({ health }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-600">
      <span className={`w-2 h-2 rounded-full ${health ? 'bg-green-500' : 'bg-slate-300'}`} />
      <span>{health ? 'Test server online' : 'Test server offline'}</span>
      {health && (
        <span className="flex items-center gap-1 pl-2 border-l border-slate-200 text-slate-500">
          <HiOutlineCpuChip className="w-4 h-4" />
          {health.gpu || 'CPU'}
        </span>
      )}
      <span className="pl-2 border-l border-slate-200 text-slate-400">{TEST_URL.replace(/^https?:\/\//, '')}</span>
    </div>
  )
}

function Download({ href, label }) {
  return (
    <a
      href={href}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg"
    >
      <HiOutlineArrowDownTray className="w-4 h-4" />
      {label}
    </a>
  )
}

function RecentRuns({ jobs, currentId, onOpen }) {
  if (!jobs.length) return null
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <h2 className="px-5 py-3 border-b border-slate-100 text-sm font-semibold text-slate-800">Runs this session</h2>
      <ul className="divide-y divide-slate-100">
        {jobs.map((j) => (
          <li key={j.id}>
            <button
              onClick={() => onOpen(j.id)}
              className={`w-full flex items-center justify-between gap-3 px-5 py-2.5 text-left text-xs transition-colors ${
                j.id === currentId ? 'bg-primary-50/60' : 'hover:bg-slate-50'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-slate-700 font-medium">{j.filename}</span>
                <span className="text-slate-400">
                  {j.settings.ocr} · {j.settings.region.toUpperCase()}
                </span>
              </span>
              <Badge variant={statusBadge[j.status]?.[0]}>{statusBadge[j.status]?.[1]}</Badge>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
