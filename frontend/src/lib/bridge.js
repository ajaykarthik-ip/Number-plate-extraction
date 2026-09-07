/**
 * Talking to bridge.py.
 *
 * A browser has no RTSP client, so an rtsp:// address cannot be shown to it.
 * bridge.py opens the camera and re-serves it as MJPEG; this module hands it
 * the URL the user typed and gets back an http:// one an <img> can render.
 */

// Override at build time with NEXT_PUBLIC_BRIDGE_URL if the bridge runs
// somewhere other than the machine showing the UI.
export const BRIDGE_URL = (process.env.NEXT_PUBLIC_BRIDGE_URL || 'http://localhost:8080').replace(
  /\/+$/,
  '',
)

/** A failure worth showing the user verbatim, rather than a stack trace. */
export class BridgeError extends Error {}

/**
 * Register a camera with the bridge and return the stream URL it serves.
 * Safe to call repeatedly: re-binding the same URL keeps the running session,
 * which is how a saved source survives a bridge restart.
 */
export async function registerCamera(cameraId, rtspUrl) {
  let res
  try {
    res = await fetch(`${BRIDGE_URL}/cameras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cameraId, url: rtspUrl }),
    })
  } catch {
    // A dropped connection and an absent server are the same event here, so the
    // message has to cover both — blaming only the second sent people looking
    // for a bridge that was already running.
    throw new BridgeError(
      `No answer from the bridge at ${BRIDGE_URL} — start it with "python bridge.py", ` +
        'or check its console if it is already running.',
    )
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new BridgeError(body.error || `The bridge refused this camera (${res.status})`)
  }
  return `${BRIDGE_URL}${body.stream}`
}

/**
 * Turn whatever was typed into a source the pane can play. The scheme decides:
 * rtsp:// goes through the bridge, http:// is used as-is.
 */
export async function bindSource(cameraId, typed) {
  const url = typed.trim()
  if (/^rtsp:\/\//i.test(url)) {
    return { protocol: 'rtsp', url, stream: await registerCamera(cameraId, url) }
  }
  if (/^https?:\/\//i.test(url)) {
    return { protocol: 'http', url }
  }
  throw new BridgeError('Enter a full address — rtsp://… for a camera, http://… for an MJPEG stream')
}

/**
 * Plates the bridge has read since `since`.
 *
 * The cursor is what keeps this honest: the bridge holds the reads and hands
 * back only what is newer than the caller has seen, so a tab that was in the
 * background misses nothing and a tab that polls fast is never given the same
 * vehicle twice. Reads carry a `crop` path, which is the piece of frame the
 * plate was actually read from — absolute-ised here so an <img> can use it.
 */
export async function fetchReads(cameraId, since = 0) {
  let res
  try {
    res = await fetch(`${BRIDGE_URL}/reads/${cameraId}?since=${since}`, { cache: 'no-store' })
  } catch {
    throw new BridgeError(`No answer from the bridge at ${BRIDGE_URL}`)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new BridgeError(body.error || `The bridge refused the read poll (${res.status})`)
  return {
    seq: body.seq || 0,
    reads: (body.reads || []).map((r) => ({
      ...r,
      crop: r.crop ? `${BRIDGE_URL}${r.crop}` : null,
    })),
  }
}

/**
 * Tell the reader which part of the picture is the lane.
 *
 * Without this the zone drawn in the UI was decoration: the box was stored in
 * the browser and the reader went on searching the whole frame. Narrowing the
 * search is both what makes it fast and what stops it reading plates parked
 * across the road.
 */
export async function pushZone(cameraId, zone) {
  try {
    await fetch(`${BRIDGE_URL}/zone/${cameraId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone }),
    })
  } catch {
    // The pane already reports a missing bridge; a second complaint about the
    // same silence would not tell anyone anything new.
  }
}

/** The URL to put in an <img>, or null when there is nothing playable. */
export function streamUrlOf(source) {
  if (!source) return null
  const url = source.stream || source.url
  return /^https?:\/\//i.test(url) ? url : null
}

/**
 * What the bridge says about one camera right now.
 *
 * An <img> reports a stream that is merely dark exactly like one that is fine,
 * so the pane cannot tell "no picture" from "no camera" on its own. This is
 * where the difference comes from: whether the bridge answers at all, and what
 * it makes of the camera bound to that id.
 */
export async function cameraHealth(cameraId) {
  let res
  try {
    res = await fetch(`${BRIDGE_URL}/cameras`, { cache: 'no-store' })
  } catch {
    return { reachable: false, camera: null }
  }
  if (!res.ok) return { reachable: true, camera: null }
  const body = await res.json().catch(() => ({}))
  return { reachable: true, camera: (body.cameras || {})[cameraId] || null }
}

/** One line explaining why there is no picture, or null when there should be. */
export function healthProblem(health, { bridged }) {
  if (!health) return null
  if (!health.reachable) {
    return bridged
      ? `No bridge answering at ${BRIDGE_URL} — start it with:  python bridge.py`
      : null // a plain http:// source needs no bridge, so its silence means nothing
  }
  if (!bridged) return null
  if (!health.camera) return 'The bridge has no camera bound here — re-save the source to rebind it'
  if (health.camera.status === 'online') return null
  return health.camera.error || 'The camera is connecting — no picture yet'
}
