#!/usr/bin/env python3
"""RTSP → MJPEG bridge for AutoGate NX.

A browser has no RTSP client, so a camera stream cannot be shown to it
directly. This opens an RTSP feed with OpenCV and re-serves it as multipart
MJPEG, which the Live View pane renders in an <img>.

Cameras can be registered two ways:

  * up front, on the command line —
        python bridge.py --url "rtsp://user:pass@192.168.1.65:554/Streaming/Channels/102"

  * or by the UI, which POSTs the RTSP URL you type into the camera form to
    /cameras and binds the http:// address that comes back. Just start it:
        python bridge.py

Credentials belong on the command line, in the UI, or in the RTSP_URL
environment variable — never in this file, which is committed.
"""

import argparse
import json
import os
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, urlparse

# Has to be set before the first VideoCapture. Over UDP a busy Wi-Fi link drops
# packets and the picture tears; TCP is slower to start but arrives intact.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

import cv2  # noqa: E402  (must follow the env var above)

import anpr  # noqa: E402  (imports cv2 itself, so it follows the same rule)

BOUNDARY = "autogatenxframe"
DEFAULT_ID = "default"


# A Windows console is cp1252 by default, and the arrows and dashes below are
# not in it. print() then raises UnicodeEncodeError from inside the request
# handler, the socket closes with no reply at all, and the UI reports the bridge
# as absent while it is sitting right there. Logging is not worth a failed
# request, so the encoding is widened here and errors are swallowed there.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass  # already wrapped, or not a real console — the fallback in log() covers it


def log(msg):
    try:
        print(f"[bridge] {msg}", flush=True)
    except UnicodeEncodeError:
        print(f"[bridge] {msg.encode('ascii', 'replace').decode('ascii')}", flush=True)


class Stream:
    """One RTSP session, shared by every viewer.

    Opening a session per browser tab would have the camera transcoding several
    copies of the same picture, and cheap IP cameras cap concurrent sessions at
    two or three. So a single thread pulls frames and every client serves from
    the newest one; a slow client skips frames instead of holding the feed back.
    """

    def __init__(self, url, width, quality):
        self.url = url
        self.width = width
        self.quality = quality
        self.cond = threading.Condition()
        self.jpeg = None
        # The browser gets a downscaled picture; the reader must not. A plate
        # across the lane is 120px wide in the camera's own 2592-wide frame and
        # 45px in the 960-wide preview, and 45px of plate reads as nothing at
        # all. So the full-resolution frame is kept here alongside the preview.
        self.frame = None
        self.seq = 0
        self.online = False
        self.error = None
        self.stopped = False
        # Set by the first decoded frame. A camera that answers on the socket
        # but never delivers a picture is the failure that used to be silent,
        # so nothing reports success until this fires.
        self.ready = threading.Event()
        self.last_frame_at = None
        threading.Thread(target=self._run, daemon=True).start()

    def latest_frame(self):
        """The newest full-resolution frame, or None before the first one."""
        return self.frame

    def stop(self):
        self.stopped = True
        self.ready.set()  # release anyone blocked in wait_ready
        with self.cond:
            self.cond.notify_all()

    def wait_ready(self, timeout):
        """Block until a frame has actually arrived. False means it never did."""
        self.ready.wait(timeout)
        return self.jpeg is not None and not self.stopped

    def stale_for(self):
        """Seconds since the last frame, or None if none has arrived yet."""
        return None if self.last_frame_at is None else time.monotonic() - self.last_frame_at

    def _run(self):
        params = [cv2.IMWRITE_JPEG_QUALITY, self.quality]
        while not self.stopped:
            cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if not cap.isOpened():
                cap.release()
                self.error = "cannot open the stream — check URL, credentials and network"
                log(f"{self.error}; retrying in 3s")
                time.sleep(3)
                continue

            log("camera connected")
            self.online = True
            self.error = None
            misses = 0
            while not self.stopped:
                ok, frame = cap.read()
                if not ok:
                    # A few empty reads are normal between key frames; a run of
                    # them means the session is gone.
                    misses += 1
                    if misses > 40:
                        break
                    time.sleep(0.05)
                    continue
                misses = 0
                self.frame = frame

                if self.width and frame.shape[1] > self.width:
                    height = round(frame.shape[0] * self.width / frame.shape[1])
                    frame = cv2.resize(frame, (self.width, height), interpolation=cv2.INTER_AREA)

                ok, buf = cv2.imencode(".jpg", frame, params)
                if not ok:
                    continue
                with self.cond:
                    self.jpeg = buf.tobytes()
                    self.seq += 1
                    self.last_frame_at = time.monotonic()
                    self.cond.notify_all()
                self.ready.set()

            self.online = False
            self.ready.clear()
            cap.release()
            if self.stopped:
                break
            self.error = "stream dropped"
            log("stream dropped — reconnecting")
            time.sleep(2)

        with self.cond:
            self.cond.notify_all()
        log("stream closed")

    def next_frame(self, seen, timeout=10.0):
        """Block until a frame newer than `seen` exists. Returns (seq, jpeg)."""
        with self.cond:
            if self.seq == seen and not self.stopped:
                self.cond.wait(timeout)
            return self.seq, self.jpeg

    def state(self):
        stale = self.stale_for()
        if self.online and self.jpeg is not None:
            status = "online"
        elif self.error:
            # "connecting" for a camera that has already failed reads as
            # progress, and that is what left the UI showing a green dot over a
            # dark pane. Say offline and let the reason travel with it.
            status = "offline"
        else:
            status = "connecting"
        return {
            "url": redact(self.url),
            "status": status,
            "frames": self.seq,
            "error": self.error,
            "staleSeconds": None if stale is None else round(stale, 1),
        }


def redact(url):
    """Credentials are not something to hand back over HTTP or print in logs."""
    at = url.rfind("@")
    scheme = url.find("://")
    if at == -1 or scheme == -1 or at < scheme:
        return url
    return f"{url[:scheme + 3]}***@{url[at + 1:]}"



class Watcher:
    """Reads plates off one camera, continuously.

    Kept apart from Stream on purpose: pulling frames must never wait on the
    reader. OCR takes a second or two and the RTSP session will not hold still
    for that, so this runs on its own thread and always works from whatever the
    newest frame happens to be — dropping frames while it thinks is correct
    behaviour here, not a shortcut.

    What it produces is a list of reads: a plate string, when it was seen, how
    sure the recogniser was, and the crop it came from. The UI polls for those
    and decides what to do about the barrier; this side has no opinion about
    who is allowed in.
    """

    MAX_READS = 200

    def __init__(self, cam_id, stream, reader, interval, min_confidence=0.0, on_read=None):
        self.cam_id = cam_id
        self.stream = stream
        self.reader = reader
        self.interval = interval
        self.min_confidence = min_confidence
        self.on_read = on_read
        self.zone = None
        self.motion = anpr.MotionGate()
        self.tracker = anpr.Tracker()
        self.reads = []
        self.seq = 0
        self.busy = False
        # Counters, so "it is reading but finding nothing" can be told apart
        # from "it stopped reading" without reading the log.
        self.attempts = 0
        self.candidates = 0
        self.last_attempt_at = None
        self.stopped = False
        self._lock = threading.Lock()
        threading.Thread(target=self._run, daemon=True).start()

    def stop(self):
        self.stopped = True

    def set_zone(self, zone):
        """The lane rectangle drawn in the UI, or None for the whole frame."""
        self.zone = zone
        log(f"{self.cam_id}: detection zone {'set' if zone else 'cleared'}")

    def since(self, seq):
        with self._lock:
            return [r for r in self.reads if r["seq"] > seq], self.seq

    def _run(self):
        while not self.stopped:
            try:
                self._pass()
            except Exception as exc:  # noqa: BLE001 - nothing may end this thread
                # Everything from a torn frame to a model that dislikes an
                # empty crop lands here. Before this, a single throw from
                # outside the read call killed the thread outright and the
                # bridge went on reporting that it was reading — silently
                # logging nothing for as long as it was left running.
                log(f"{self.cam_id}: read pass failed: {exc!r}")
                time.sleep(1.0)

    def _pass(self):
        frame = self.stream.latest_frame()
        if frame is None:
            time.sleep(0.5)
            return

        regions = self.motion.regions(frame)
        if not regions:
            # Nothing moved. This is the common case by a wide margin, and it
            # has to stay cheap or the reader eats a core doing nothing.
            time.sleep(self.interval)
            return

        self.attempts += 1
        self.last_attempt_at = time.time()
        self.busy = True
        try:
            found = self.reader.read_frame(frame, self.zone, regions)
        finally:
            self.busy = False
        self.candidates += len(found)

        for hit in found:
            # A read the recogniser is unsure of is worse than no read: it
            # reaches the log looking exactly like a confident one. The floor
            # throws those away before the tracker ever sees them.
            if hit["confidence"] < self.min_confidence:
                continue
            confidence = self.tracker.offer(hit["plate"], hit["confidence"])
            if confidence is not None:
                self._record(frame, hit, confidence)
        time.sleep(self.interval)

    def _record(self, frame, hit, confidence):
        x, y, w, h = hit["box"]
        crop = frame[max(0, y):y + h, max(0, x):x + w]
        ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 80])
        with self._lock:
            self.seq += 1
            read = {
                "seq": self.seq,
                "id": f"{self.cam_id}-{self.seq}",
                "camera": self.cam_id,
                "plate": hit["plate"],
                "confidence": confidence,
                "at": time.time(),
                "box": hit["box"],
                "crop": buf.tobytes() if ok else None,
            }
            self.reads.append(read)
            del self.reads[: -self.MAX_READS]
        log(f"{self.cam_id}: read {hit['plate']} ({confidence:.2f})")

    def crop_of(self, read_id):
        with self._lock:
            for read in self.reads:
                if read["id"] == read_id:
                    return read["crop"]
        return None

    def state(self):
        with self._lock:
            recent = self.reads[-1] if self.reads else None
            return {
                "reading": True,
                "zone": self.zone,
                "reads": len(self.reads),
                "lastPlate": recent["plate"] if recent else None,
                "attempts": self.attempts,
                "candidates": self.candidates,
                "lastAttemptAt": self.last_attempt_at,
            }


class Cameras:
    """Which camera id is bound to which stream."""

    def __init__(self, opts, reader=None):
        self.opts = opts
        self.reader = reader
        self._lock = threading.Lock()
        self._streams = {}
        self._watchers = {}

    def bind(self, cam_id, url):
        with self._lock:
            current = self._streams.get(cam_id)
            # Re-binding the same URL keeps the running session: the UI calls
            # this again on every reload to survive a bridge restart.
            if current and current.url == url and not current.stopped:
                return current
            if current:
                current.stop()
                watcher = self._watchers.pop(cam_id, None)
                if watcher:
                    watcher.stop()
            log(f"binding {cam_id} → {redact(url)}")
            stream = Stream(url, self.opts.width, self.opts.quality)
            self._streams[cam_id] = stream
            return stream

    def watch(self, cam_id, zone=None):
        """Start reading plates off a bound camera. No reader, no watcher."""
        if self.reader is None:
            return None
        with self._lock:
            stream = self._streams.get(cam_id)
            if stream is None:
                return None
            watcher = self._watchers.get(cam_id)
            if watcher is None or watcher.stopped:
                watcher = Watcher(
                    cam_id,
                    stream,
                    self.reader,
                    self.opts.read_interval,
                    self.opts.min_confidence,
                )
                self._watchers[cam_id] = watcher
            if zone is not None:
                watcher.set_zone(zone or None)
            return watcher

    def watcher(self, cam_id):
        with self._lock:
            return self._watchers.get(cam_id)

    def get(self, cam_id):
        with self._lock:
            return self._streams.get(cam_id)

    def drop(self, cam_id):
        with self._lock:
            stream = self._streams.pop(cam_id, None)
            watcher = self._watchers.pop(cam_id, None)
        if watcher:
            watcher.stop()
        if stream:
            stream.stop()
        return bool(stream)

    def state(self):
        with self._lock:
            state = {}
            for cid, stream in self._streams.items():
                entry = stream.state()
                watcher = self._watchers.get(cid)
                entry["anpr"] = watcher.state() if watcher else {"reading": False}
                state[cid] = entry
            return state


def connect_failure(opts):
    return (
        f"no picture from the camera within {opts.connect_timeout}s — check the URL, "
        "the credentials and that the device is reachable"
    )


def guarded(method):
    """Answer every request, even a broken one.

    An exception escaping a handler leaves the client with an empty reply, which
    a browser cannot tell from a bridge that was never started — the failure
    then gets blamed on the wrong thing entirely. Say what went wrong instead.
    """

    def wrapper(self):
        try:
            method(self)
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass  # the tab was closed mid-response
        except Exception as exc:  # noqa: BLE001 - the whole point is to catch everything
            log(f"error handling {self.command} {self.path}: {exc!r}")
            if not self.responded:
                self.send_json({"error": f"the bridge failed on this request: {exc}"}, status=500)

    wrapper.__name__ = method.__name__
    return wrapper


class Handler(BaseHTTPRequestHandler):
    # Closing the connection at the end of a response keeps the multipart reply
    # simple: no chunked framing, no length to predict.
    protocol_version = "HTTP/1.0"
    cameras = None
    # Whether a status line has gone out yet, so the guard above knows if an
    # error response is still possible or would just corrupt one in flight.
    responded = False

    def send_response(self, *args, **kwargs):
        self.responded = True
        super().send_response(*args, **kwargs)

    # --- routing -----------------------------------------------------------

    def do_OPTIONS(self):
        # The UI runs on another port, so a JSON POST is preflighted.
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    @guarded
    def do_GET(self):
        head, cam_id = self.route()
        if head == "stream":
            self.serve_stream(cam_id)
        elif head == "snapshot":
            self.serve_snapshot(cam_id)
        elif head == "reads":
            self.serve_reads(cam_id)
        elif head == "read":
            self.serve_read_crop()
        elif head in ("health", "cameras", ""):
            self.send_json({"cameras": self.cameras.state()})
        else:
            self.send_json({"error": "not found"}, status=404)

    @guarded
    def do_POST(self):
        head, cam_id = self.route()
        if head == "zone":
            self.set_zone(cam_id)
            return
        if head != "cameras":
            self.send_json({"error": "not found"}, status=404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or "{}")
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "expected a JSON body"}, status=400)
            return

        cam_id = str(body.get("id") or DEFAULT_ID).strip()
        url = str(body.get("url") or "").strip()
        if not url.lower().startswith("rtsp://"):
            self.send_json({"error": "url must be an rtsp:// address"}, status=400)
            return
        if "/" in cam_id or not cam_id:
            self.send_json({"error": "id must be a plain name"}, status=400)
            return

        zone = body.get("zone")
        stream = self.cameras.bind(cam_id, url)
        # Binding used to answer 200 the instant the thread was spawned, so a
        # camera that never connected still came back as a working stream URL
        # and the pane sat dark with a green dot over it. Wait for a real frame
        # and hand back the reason when none arrives.
        if not stream.wait_ready(self.cameras.opts.connect_timeout):
            self.cameras.drop(cam_id)
            self.send_json({"error": stream.error or connect_failure(self.cameras.opts)}, status=502)
            return
        # Reading starts with the binding: a camera the UI has connected is one
        # it wants plates from, and making that a second call would leave a
        # window where the feed is up and nothing is watching it.
        watcher = self.cameras.watch(cam_id, zone)
        self.send_json(
            {
                "id": cam_id,
                "stream": f"/stream/{cam_id}",
                "snapshot": f"/snapshot/{cam_id}",
                "reads": f"/reads/{cam_id}" if watcher else None,
                "anpr": bool(watcher),
            }
        )

    def set_zone(self, cam_id):
        """Point the reader at the lane the operator drew over the picture."""
        watcher = self.cameras.watcher(cam_id or DEFAULT_ID)
        if watcher is None:
            self.send_json({"error": f"no camera reading as '{cam_id or DEFAULT_ID}'"}, status=404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or "{}")
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "expected a JSON body"}, status=400)
            return
        zone = body.get("zone")
        if zone is not None and not all(isinstance(zone.get(k), (int, float)) for k in "xywh"):
            self.send_json({"error": "zone needs numeric x, y, w and h"}, status=400)
            return
        watcher.set_zone(zone)
        self.send_json({"zone": watcher.zone})

    @guarded
    def do_DELETE(self):
        head, cam_id = self.route()
        if head != "cameras":
            self.send_json({"error": "not found"}, status=404)
            return
        self.send_json({"dropped": self.cameras.drop(cam_id or DEFAULT_ID)})

    def route(self):
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        return (parts[0] if parts else ""), (parts[1] if len(parts) > 1 else "")

    def query(self):
        return dict(parse_qsl(urlparse(self.path).query))

    def serve_reads(self, cam_id):
        """Plates read since the caller's last poll.

        The UI holds a cursor and asks for what is newer, so a slow tab misses
        nothing and a fast one is not handed the same read twice. The crops
        stay here and are fetched by URL — a base64 image per read would make
        this response many times larger than the data it is carrying.
        """
        watcher = self.cameras.watcher(cam_id or DEFAULT_ID)
        if watcher is None:
            if self.cameras.reader is None:
                self.send_json({"error": "the bridge is running without a reader", "reads": []}, status=409)
            else:
                self.send_json({"error": f"no camera bound as '{cam_id or DEFAULT_ID}'", "reads": []}, status=404)
            return
        try:
            since = int(self.query().get("since", 0))
        except ValueError:
            since = 0
        reads, seq = watcher.since(since)
        self.send_json(
            {
                "seq": seq,
                "reads": [
                    {
                        "id": r["id"],
                        "plate": r["plate"],
                        "confidence": r["confidence"],
                        "at": r["at"],
                        "box": r["box"],
                        "crop": f"/read/{r['camera']}/{r['id']}.jpg" if r["crop"] else None,
                    }
                    for r in reads
                ],
            }
        )

    def serve_read_crop(self):
        """The piece of frame a plate was read from — proof, for the feed."""
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        if len(parts) < 3:
            self.send_json({"error": "not found"}, status=404)
            return
        watcher = self.cameras.watcher(parts[1])
        crop = watcher.crop_of(parts[2].removesuffix(".jpg")) if watcher else None
        if crop is None:
            self.send_json({"error": "no such read"}, status=404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(crop)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.cors()
        self.end_headers()
        self.wfile.write(crop)

    # --- responses ---------------------------------------------------------

    def stream_for(self, cam_id):
        stream = self.cameras.get(cam_id or DEFAULT_ID)
        if stream is None:
            self.send_json({"error": f"no camera bound as '{cam_id or DEFAULT_ID}'"}, status=404)
        return stream

    def serve_stream(self, cam_id):
        stream = self.stream_for(cam_id)
        if stream is None:
            return

        # An <img> only reports failure through a bad response: a 200 that never
        # sends a byte looks to the browser exactly like a camera that is merely
        # quiet, so it fires no error and the pane stays black for good. Fail the
        # request instead, and the UI can say why.
        if not stream.wait_ready(self.cameras.opts.connect_timeout):
            self.send_json({"error": stream.error or connect_failure(self.cameras.opts)}, status=503)
            return

        self.send_response(200)
        self.send_header("Content-Type", f"multipart/x-mixed-replace; boundary={BOUNDARY}")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.cors()
        self.end_headers()

        seen = 0
        try:
            while not stream.stopped:
                seq, jpeg = stream.next_frame(seen, timeout=self.cameras.opts.stall_timeout)
                # Same reasoning in the other direction: once a camera goes away
                # mid-session, holding the response open freezes the last frame
                # on screen forever. Ending it lets the viewer notice and retry.
                if seq == seen or jpeg is None:
                    log(f"no frame for {self.cameras.opts.stall_timeout}s — closing {cam_id or DEFAULT_ID}")
                    break
                seen = seq
                self.wfile.write(
                    f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\n"
                    f"Content-Length: {len(jpeg)}\r\n\r\n".encode()
                )
                self.wfile.write(jpeg)
                self.wfile.write(b"\r\n")
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass  # the tab was closed, or the feed was stopped

    def serve_snapshot(self, cam_id):
        stream = self.stream_for(cam_id)
        if stream is None:
            return
        if not stream.wait_ready(self.cameras.opts.connect_timeout):
            self.send_json({"error": stream.error or connect_failure(self.cameras.opts)}, status=503)
            return
        _, jpeg = stream.next_frame(0)
        if jpeg is None:
            self.send_json({"error": "no frame yet"}, status=503)
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(jpeg)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(jpeg)

    def send_json(self, payload, status=200):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.cors()
        self.end_headers()
        self.wfile.write(data)

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")

    def log_message(self, *args):
        pass  # one line per frame request would drown the useful output


def main():
    ap = argparse.ArgumentParser(description="Serve RTSP cameras as MJPEG over HTTP.")
    ap.add_argument("--url", default=os.environ.get("RTSP_URL"),
                    help="optional RTSP URL to bind at startup; the UI can also register cameras. "
                         "Percent-encode specials in the password (@ is %%40).")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--host", default="127.0.0.1", help="0.0.0.0 to reach it from another machine")
    ap.add_argument("--width", type=int, default=960, help="downscale wider frames; 0 keeps native size")
    ap.add_argument("--quality", type=int, default=70, help="JPEG quality, 1-100")
    ap.add_argument("--connect-timeout", type=float, default=12.0,
                    help="seconds to wait for a camera's first frame before reporting failure")
    ap.add_argument("--stall-timeout", type=float, default=10.0,
                    help="seconds without a frame before an open stream is closed")
    ap.add_argument("--no-anpr", action="store_true",
                    help="serve video only, without reading plates")
    ap.add_argument("--read-interval", type=float, default=0.4,
                    help="seconds between plate-reading passes on a moving frame")
    ap.add_argument("--gpu", action="store_true", help="run the recogniser on CUDA if it is there")
    ap.add_argument("--model", default=os.environ.get("PLATE_MODEL"),
                    help="optional trained plate detector (.pt) — far better at finding plates "
                         "in a wide shot than the built-in edge finder, and needs `pip install "
                         "ultralytics`. Without one, the built-in finder is used.")
    ap.add_argument("--min-confidence", type=float, default=0.35,
                    help="reads below this are dropped rather than logged")
    args = ap.parse_args()

    reader = None
    if not args.no_anpr:
        # Several seconds of loading torch and the OCR weights, once, before
        # the socket opens: a camera that binds while this is still happening
        # would otherwise be watched by nothing.
        log("loading the plate reader — this takes a few seconds the first time")
        try:
            reader = anpr.Reader(gpu=args.gpu, model=args.model)
            log(f"plate reader ready ({'trained detector' if args.model else 'built-in finder'})")
        except Exception as exc:  # noqa: BLE001 - video is still worth serving
            log(f"could not load the plate reader ({exc}); serving video only")
            log("install it with:  pip install -r requirements.txt")

    Handler.cameras = Cameras(args, reader)
    if args.url:
        Handler.cameras.bind(DEFAULT_ID, args.url)
        Handler.cameras.watch(DEFAULT_ID)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True

    where = f"http://{'localhost' if args.host == '127.0.0.1' else args.host}:{args.port}"
    log(f"listening on {where}")
    if args.url:
        log(f"bound {where}/stream/{DEFAULT_ID} — usable directly as an HTTP / MJPEG source")
    log("paste the rtsp:// URL into the camera form in the UI; it registers here automatically")
    if reader is None:
        log("plate reading is OFF — the UI will show the picture but log no reads")
    else:
        log(f"reading plates every {args.read_interval:.1f}s while something is moving")
    if args.host != "127.0.0.1":
        log("WARNING: reachable from the network, and anyone who reaches it can open any RTSP URL")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("stopped")
        server.server_close()


if __name__ == "__main__":
    sys.exit(main())
