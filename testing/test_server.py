#!/usr/bin/env python3
"""HTTP server for the Testing page: upload a video, watch it being read.

Runs on its own port (8090) so it never competes with bridge.py (8080) and can
be started or stopped without touching the live camera feed.

    python testing/test_server.py --sample "C:\\Users\\Ajay\\Downloads\\clip.mp4"

Endpoints
    GET  /health                    model, OCR engines, GPU, sample video
    GET  /jobs                      every job this session
    POST /jobs?ocr=&region=&sample_fps=&min_conf=&filename=   body = raw video bytes
    POST /jobs/sample?ocr=&region=&sample_fps=&min_conf=      runs the --sample video
    GET  /jobs/<id>                 status, progress, tracks so far / results
    POST /jobs/<id>/cancel
    GET  /jobs/<id>/preview         MJPEG of annotated frames while it runs
    GET  /jobs/<id>/video           the source video (Range-capable, for <video>)
    GET  /jobs/<id>/boxes           per-frame boxes for the overlay
    GET  /jobs/<id>/files/<path>    annotated.mp4, results.csv, crops/track_N.jpg
"""

import argparse
import json
import mimetypes
import os
import queue
import re
import shutil
import socket
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

import plate_rules  # noqa: E402
from ocr_engines import ENGINE_NAMES, load_engines  # noqa: E402
from plate_video import DEFAULT_MODEL, DEFAULT_OUT, PlateVideoProcessor  # noqa: E402
import evaluate  # noqa: E402

BOUNDARY = "platetestframe"
MAX_UPLOAD = 2 * 1024**3
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


class Job:
    def __init__(self, video, filename, settings):
        self.id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
        self.video, self.filename, self.settings = video, filename, settings
        self.out_dir = os.path.join(DEFAULT_OUT, self.id)
        self.status = "queued"
        self.error = None
        self.progress = {"frame": 0, "total": 0, "fps": 0, "tracks": []}
        self.results = None
        self.created = time.time()
        self.stop = threading.Event()
        self.frame_seq = 0
        self.frame_jpeg = None
        self.cond = threading.Condition()

    def set_preview(self, jpeg):
        with self.cond:
            self.frame_seq += 1
            self.frame_jpeg = jpeg
            self.cond.notify_all()

    def next_preview(self, seen, timeout=5.0):
        with self.cond:
            if self.frame_seq == seen:
                self.cond.wait(timeout)
            return self.frame_seq, self.frame_jpeg

    def state(self, full=True):
        s = {"id": self.id, "filename": self.filename, "settings": self.settings, "status": self.status,
             "error": self.error, "created": self.created,
             "progress": {k: v for k, v in self.progress.items() if k != "tracks"}}
        if full:
            s["tracks"] = self.results["tracks"] if self.results else self.progress["tracks"]
            s["results"] = {k: v for k, v in self.results.items() if k != "tracks"} if self.results else None
        return s


class Runner:
    """One job at a time: the GPU is shared, and two at once would each run at half speed."""

    def __init__(self, opts):
        self.opts = opts
        self.jobs = {}
        self.queue = queue.Queue()
        self.engines = {}  # cached across jobs: EasyOCR takes seconds to load
        self.engine_errors = {}
        self.lock = threading.Lock()
        threading.Thread(target=self._loop, daemon=True).start()

    def submit(self, video, filename, settings):
        job = Job(video, filename, settings)
        self.jobs[job.id] = job
        self.queue.put(job)
        log(f"queued {job.id} ({filename}, {settings})")
        return job

    def engines_for(self, choice):
        wanted = ENGINE_NAMES if choice in ("all", "both") else (choice,)
        with self.lock:
            for name in wanted:
                if name not in self.engines and name not in self.engine_errors:
                    loaded, errors = load_engines(name, gpu=not self.opts.cpu)
                    if loaded:
                        self.engines[name] = loaded[0]
                    self.engine_errors.update(errors)
            return [self.engines[n] for n in wanted if n in self.engines], \
                {n: self.engine_errors[n] for n in wanted if n in self.engine_errors}

    def _loop(self):
        while True:
            job = self.queue.get()
            if job.stop.is_set():
                job.status = "cancelled"
                continue
            job.status = "running"
            try:
                engines, errors = self.engines_for(job.settings["ocr"])
                if not engines:
                    raise RuntimeError("; ".join(f"{k}: {v}" for k, v in errors.items()))
                sample_fps = job.settings["sample_fps"]
                proc = PlateVideoProcessor(
                    job.video, job.out_dir, model=self.opts.model, ocr=job.settings["ocr"],
                    region=job.settings["region"], min_conf=job.settings["min_conf"],
                    sample_fps=sample_fps, confirm_votes=2 if sample_fps and sample_fps < 5 else 3,
                    device="cpu" if self.opts.cpu else None, engines=engines,
                    on_progress=lambda p, j=job: setattr(j, "progress", p),
                    on_preview=job.set_preview, stop_event=job.stop,
                )
                results = proc.run()
                results["engine_errors"] = errors
                job.results = results
                job.progress = {**job.progress, "frame": results["frames"], "total": results["total_frames"]}
                job.status = "cancelled" if results["cancelled"] else "done"
                results["evaluation"] = score(job.filename, results)
                confirmed = len(results["tracks"])
                log(f"{job.id} {job.status} in {results['seconds']}s — {confirmed} confirmed plates")
            except Exception as exc:  # noqa: BLE001 - shown on the Testing page
                job.status, job.error = "error", str(exc)
                log(f"{job.id} failed: {exc}")
            finally:
                job.set_preview(job.frame_jpeg)  # wake preview streams so they can close


def score(filename, results):
    """Correct / wrong per plate, when an answer key exists for this video.

    Answer keys live in testing/ground_truth/<video name>.txt (see evaluate.py).
    Without one there is nothing to check against, and None is returned.
    """
    path = os.path.join(HERE, "ground_truth", f"{evaluate.safe_name(filename)}.txt")
    if not os.path.isfile(path):
        return None
    truth, reference = evaluate.load_truth(path)
    verdicts = {}
    for t in results["tracks"]:
        p = t["plate"]
        if p in truth:
            verdicts[p] = {"verdict": "correct", "real": p}
        elif any(r in p for r in reference):
            verdicts[p] = {"verdict": "unverifiable", "real": None}
        else:
            near, _ = evaluate.nearest(p, list(truth))
            verdicts[p] = {"verdict": "wrong", "real": near}
    confirmed = {t["plate"] for t in results["tracks"]}
    captured = [p for p in truth if p in confirmed]
    wrong = [p for p, v in verdicts.items() if v["verdict"] == "wrong"]
    return {
        "truth_file": os.path.basename(path),
        "truth_count": len(truth),
        "captured": len(captured),
        "missed": sorted(p for p in truth if p not in confirmed),
        "wrong": len(wrong),
        "recall": round(len(captured) / len(truth), 4) if truth else 0,
        "precision": round(len(captured) / (len(captured) + len(wrong)), 4) if captured or wrong else 0,
        "verdicts": verdicts,
    }


def guarded(method):
    def wrapper(self):
        try:
            method(self)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, socket.timeout):
            pass
        except Exception as exc:  # noqa: BLE001
            log(f"{self.command} {self.path} failed: {exc}")
            try:
                self.send_json({"error": str(exc)}, status=500)
            except OSError:
                pass
    return wrapper


class Handler(BaseHTTPRequestHandler):
    runner = None
    opts = None
    protocol_version = "HTTP/1.1"

    # -- routing ---------------------------------------------------------------

    @guarded
    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.send_header("Content-Length", "0")
        self.end_headers()

    @guarded
    def do_GET(self):
        parts = self.parts()
        if parts in ([], ["health"]):
            return self.send_json(self.health())
        if parts == ["jobs"]:
            jobs = sorted(self.runner.jobs.values(), key=lambda j: j.created, reverse=True)
            return self.send_json({"jobs": [j.state(full=False) for j in jobs]})
        if len(parts) >= 2 and parts[0] == "jobs":
            job = self.runner.jobs.get(parts[1])
            if not job:
                return self.send_json({"error": "no such job"}, status=404)
            rest = parts[2:]
            if not rest:
                return self.send_json(job.state())
            if rest == ["preview"]:
                return self.serve_preview(job)
            if rest == ["video"]:
                return self.serve_file(job.video, allow_range=True)
            if rest == ["boxes"]:
                return self.serve_file(os.path.join(job.out_dir, "boxes.json"))
            if rest[0] == "files" and len(rest) > 1:
                path = os.path.normpath(os.path.join(job.out_dir, *rest[1:]))
                if not path.startswith(os.path.normpath(job.out_dir) + os.sep):
                    return self.send_json({"error": "bad path"}, status=400)
                return self.serve_file(path, allow_range=True)
        self.send_json({"error": "not found"}, status=404)

    @guarded
    def do_POST(self):
        parts = self.parts()
        q = self.query()
        if parts == ["jobs"]:
            return self.create_upload_job(q)
        if parts == ["jobs", "sample"]:
            self.drain()
            if not self.opts.sample or not os.path.isfile(self.opts.sample):
                return self.send_json({"error": "no sample video — start the server with --sample <path>"},
                                      status=400)
            job = self.runner.submit(self.opts.sample, os.path.basename(self.opts.sample), self.settings(q))
            return self.send_json(job.state(), status=201)
        if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "cancel":
            self.drain()
            job = self.runner.jobs.get(parts[1])
            if not job:
                return self.send_json({"error": "no such job"}, status=404)
            job.stop.set()
            return self.send_json(job.state(full=False))
        self.drain()
        self.send_json({"error": "not found"}, status=404)

    # -- handlers --------------------------------------------------------------

    def settings(self, q):
        ocr = q.get("ocr", "plate")
        region = q.get("region", "auto")
        if ocr not in (*ENGINE_NAMES, "all"):
            raise ValueError("ocr must be plate, easyocr, tesseract or all")
        if region not in plate_rules.REGIONS:
            raise ValueError(f"region must be one of {', '.join(plate_rules.REGIONS)}")
        sample = q.get("sample_fps", "2")
        sample_fps = None if sample in ("", "all", "0") else float(sample)
        if sample_fps is not None and not 0.2 <= sample_fps <= 60:
            raise ValueError("sample_fps must be between 0.2 and 60, or 'all'")
        return {"ocr": ocr, "region": region, "sample_fps": sample_fps,
                "min_conf": max(0.0, min(1.0, float(q.get("min_conf", 0.1))))}

    def create_upload_job(self, q):
        length = int(self.headers.get("Content-Length") or 0)
        filename = os.path.basename(q.get("filename") or "upload.mp4")
        ext = os.path.splitext(filename)[1].lower()
        if not length:
            return self.send_json({"error": "empty upload"}, status=400)
        if length > MAX_UPLOAD:
            self.close_connection = True
            return self.send_json({"error": "video larger than 2 GB"}, status=413)
        if ext not in VIDEO_EXT:
            self.drain()
            return self.send_json({"error": f"unsupported file type {ext or '(none)'}"}, status=400)
        try:
            settings = self.settings(q)
        except ValueError as exc:
            self.drain()
            return self.send_json({"error": str(exc)}, status=400)
        upload_dir = os.path.join(DEFAULT_OUT, "_uploads")
        os.makedirs(upload_dir, exist_ok=True)
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", filename)
        path = os.path.join(upload_dir, f"{uuid.uuid4().hex[:8]}-{safe}")
        remaining = length
        with open(path, "wb") as f:
            while remaining:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        if remaining:
            os.remove(path)
            return self.send_json({"error": "upload interrupted"}, status=400)
        job = self.runner.submit(path, filename, settings)
        self.send_json(job.state(), status=201)

    def health(self):
        try:
            import torch

            gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() and not self.opts.cpu else None
        except Exception:  # noqa: BLE001
            gpu = None
        return {
            "ok": True,
            "model": os.path.basename(self.opts.model),
            "model_found": os.path.isfile(self.opts.model),
            "gpu": gpu,
            "engines_loaded": list(self.runner.engines),
            "engine_errors": self.runner.engine_errors,
            "tesseract_found": bool(shutil.which("tesseract"))
            or os.path.isfile(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
            "sample": os.path.basename(self.opts.sample) if self.opts.sample else None,
            "busy": any(j.status == "running" for j in self.runner.jobs.values()),
        }

    def serve_preview(self, job):
        self.send_response(200)
        self.send_header("Content-Type", f"multipart/x-mixed-replace; boundary={BOUNDARY}")
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.close_connection = True
        seen = 0
        while True:
            seq, jpeg = job.next_preview(seen)
            if seq != seen and jpeg:
                seen = seq
                self.wfile.write(f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\n"
                                 f"Content-Length: {len(jpeg)}\r\n\r\n".encode())
                self.wfile.write(jpeg)
                self.wfile.write(b"\r\n")
            if job.status not in ("queued", "running"):
                break

    def serve_file(self, path, allow_range=False):
        if not os.path.isfile(path):
            return self.send_json({"error": "not ready"}, status=404)
        size = os.path.getsize(path)
        start, end = 0, size - 1
        rng = self.headers.get("Range") if allow_range else None
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.cors()
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        if path.endswith((".csv", "annotated.mp4")):
            self.send_header("Content-Disposition", f'attachment; filename="{os.path.basename(path)}"')
        self.cors()
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining:
                chunk = f.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    # -- helpers ---------------------------------------------------------------

    def parts(self):
        return [unquote(p) for p in urlparse(self.path).path.split("/") if p]

    def query(self):
        return dict(parse_qsl(urlparse(self.path).query))

    def drain(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)

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
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges")

    def log_message(self, *args):
        pass


def main():
    ap = argparse.ArgumentParser(description="Video plate-reading test server for the Testing page.")
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--model", default=os.environ.get("PLATE_TEST_MODEL", DEFAULT_MODEL))
    ap.add_argument("--sample", default=os.environ.get("PLATE_TEST_SAMPLE"),
                    help="a video the page can run with one click")
    ap.add_argument("--cpu", action="store_true", help="force CPU for YOLO and EasyOCR")
    args = ap.parse_args()

    Handler.opts = args
    Handler.runner = Runner(args)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    log(f"plate test server on http://{'localhost' if args.host == '127.0.0.1' else args.host}:{args.port}")
    log(f"model: {args.model} ({'found' if os.path.isfile(args.model) else 'MISSING'})")
    if args.sample:
        log(f"sample: {args.sample} ({'found' if os.path.isfile(args.sample) else 'MISSING'})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("stopped")
        server.server_close()


if __name__ == "__main__":
    sys.exit(main())
