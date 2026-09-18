/**
 * Talking to testing/test_server.py — the video plate-reading test bench.
 *
 * Separate from bridge.js on purpose: the test server runs on its own port and
 * nothing on the live pages depends on it being up.
 */

export const TEST_URL = (process.env.NEXT_PUBLIC_TEST_SERVER_URL || 'http://localhost:8090').replace(
  /\/+$/,
  '',
)

export class TestServerError extends Error {}

const START_HINT = `No answer from the test server at ${TEST_URL} — start it with:  python testing/test_server.py`

async function call(path, options = {}) {
  let res
  try {
    res = await fetch(`${TEST_URL}${path}`, { cache: 'no-store', ...options })
  } catch {
    throw new TestServerError(START_HINT)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new TestServerError(body.error || `Test server refused the request (${res.status})`)
  return body
}

export const serverHealth = () => call('/health')

export const listJobs = () => call('/jobs').then((b) => b.jobs || [])

export const getJob = (id) => call(`/jobs/${id}`)

export const cancelJob = (id) => call(`/jobs/${id}/cancel`, { method: 'POST' })

const settingsQuery = ({ ocr, region, minConf, sampleFps }) =>
  new URLSearchParams({ ocr, region, min_conf: String(minConf), sample_fps: String(sampleFps) })

/** Upload a video file as the raw request body and start reading it. */
export function uploadVideo(file, settings) {
  const q = settingsQuery(settings)
  q.set('filename', file.name)
  return call(`/jobs?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
}

/** Run the video the server was started with (--sample). */
export const runSample = (settings) =>
  call(`/jobs/sample?${settingsQuery(settings)}`, { method: 'POST' })

export const previewUrl = (id) => `${TEST_URL}/jobs/${id}/preview`
export const videoUrl = (id) => `${TEST_URL}/jobs/${id}/video`
export const fileUrl = (id, path) => `${TEST_URL}/jobs/${id}/files/${path}`

export async function fetchBoxes(id) {
  const res = await fetch(`${TEST_URL}/jobs/${id}/boxes`, { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}
