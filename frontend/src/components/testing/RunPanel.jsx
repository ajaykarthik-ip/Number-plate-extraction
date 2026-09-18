'use client'

import { useRef, useState } from 'react'
import { HiOutlineArrowUpTray, HiOutlineFilm, HiOutlinePlay } from 'react-icons/hi2'

const OCR_OPTIONS = [
  { value: 'plate', label: 'Plate model (fast-plate-ocr)' },
  { value: 'easyocr', label: 'EasyOCR' },
  { value: 'tesseract', label: 'Tesseract' },
  { value: 'all', label: 'All engines (compare)' },
]

// How many frames of each second of video are read. Fewer is faster; a car is
// readable for 2-10 s, so 2 a second gives every plate several reads.
const SAMPLE_OPTIONS = [
  { value: '1', label: '1 frame / second (fastest)' },
  { value: '2', label: '2 frames / second (recommended)' },
  { value: '3', label: '3 frames / second' },
  { value: '5', label: '5 frames / second' },
  { value: 'all', label: 'Every frame (slowest)' },
]

const REGION_OPTIONS = [
  { value: 'auto', label: 'UK + India (auto)' },
  { value: 'uk', label: 'UK only (AB12 CDE)' },
  { value: 'in', label: 'India only (TN 09 BX 4521)' },
  { value: 'any', label: 'Any format (loose)' },
]

/** Pick a video and the reading settings, then start a run. */
export default function RunPanel({ health, busy, onUpload, onSample }) {
  const [file, setFile] = useState(null)
  const [ocr, setOcr] = useState('plate')
  const [region, setRegion] = useState('auto')
  const [minConf, setMinConf] = useState(0.1)
  const [sampleFps, setSampleFps] = useState('2')
  const inputRef = useRef(null)

  const settings = { ocr, region, minConf, sampleFps }
  const offline = !health

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">New run</h2>
        <p className="text-xs text-slate-500 mt-1">
          YOLO finds and tracks each plate, then OCR reads it across frames. Only valid plates confirmed by several identical reads are shown.
        </p>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-lg border-2 border-dashed border-slate-300 hover:border-primary-400 hover:bg-primary-50/40 text-slate-500 transition-colors"
      >
        <HiOutlineArrowUpTray className="w-6 h-6" />
        <span className="text-sm font-medium text-slate-700 truncate max-w-full">
          {file ? file.name : 'Choose a video file'}
        </span>
        <span className="text-xs">
          {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'MP4, MOV, MKV, AVI, WebM'}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-slate-500">OCR engine</span>
          <select className="input" value={ocr} onChange={(e) => setOcr(e.target.value)}>
            {OCR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Plate format</span>
          <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
            {REGION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-slate-500">Frames read</span>
        <select className="input" value={sampleFps} onChange={(e) => setSampleFps(e.target.value)}>
          {SAMPLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1.5">
        <span className="flex justify-between text-xs font-medium text-slate-500">
          <span>Minimum OCR confidence</span>
          <span className="tabular-nums text-slate-700">{Math.round(minConf * 100)}%</span>
        </span>
        <input
          type="range"
          min="0"
          max="0.9"
          step="0.05"
          value={minConf}
          onChange={(e) => setMinConf(Number(e.target.value))}
          className="w-full accent-primary-600"
        />
      </label>

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          disabled={!file || busy || offline}
          onClick={() => onUpload(file, settings)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <HiOutlinePlay className="w-4 h-4" />
          Upload &amp; run
        </button>
        {health?.sample && (
          <button
            type="button"
            disabled={busy || offline}
            onClick={() => onSample(settings)}
            title={health.sample}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-sm font-medium rounded-lg border border-slate-200 transition-colors"
          >
            <HiOutlineFilm className="w-4 h-4" />
            Run sample video
          </button>
        )}
      </div>
    </div>
  )
}
