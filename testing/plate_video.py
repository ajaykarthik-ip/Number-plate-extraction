#!/usr/bin/env python3
"""Track number plates through a video and read each one.

    frame -> YOLO plate detector -> ByteTrack (a stable id per plate)
          -> crop -> OCR (plate model / EasyOCR / Tesseract) -> format repair
          -> vote across every read of that id -> one plate per vehicle

The vote is the point. A plate is on screen for dozens of frames and any single
read of it can be wrong — an 8 for a B, a dropped letter as it blurs. Reading
the same tracked plate several times and letting the reads agree is what turns
a noisy per-frame OCR into a trustworthy answer.

Standalone: nothing in bridge.py or the live UI depends on this file.

    python testing/plate_video.py --video "C:\\path\\clip.mp4" --ocr easyocr --show
"""

import argparse
import csv
import json
import os
import sys
import threading
import time
from collections import Counter, defaultdict

import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import plate_rules  # noqa: E402
from ocr_engines import load_engines  # noqa: E402

DEFAULT_MODEL = os.path.join(HERE, "models", "plate-yolo11s.pt")
DEFAULT_OUT = os.path.join(HERE, "output")

# Box colours (BGR) by how sure we are of the plate.
CONFIRMED = (80, 200, 60)
READING = (0, 190, 255)
UNREAD = (180, 180, 180)


def sharpness(crop):
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def pad_box(x1, y1, x2, y2, w, h):
    """A little context round the box: detectors clip the plate's edge characters."""
    px, py = (x2 - x1) * 0.08, (y2 - y1) * 0.15
    return (max(0, int(x1 - px)), max(0, int(y1 - py)), min(w, int(x2 + px)), min(h, int(y2 + py)))


class Track:
    def __init__(self, tid, frame_idx):
        self.id = tid
        self.first = self.last = frame_idx
        self.seen = 0
        self.last_ocr = -10**9
        self.attempts = 0
        self.best_quality = 0.0
        self.best_crop = None
        self.reads = defaultdict(list)  # engine -> [(plate, conf, valid)]
        self.result = {}  # engine -> consensus dict

    def vote(self, engine):
        """Consensus for one engine's reads of this plate, from valid reads only.

        Reads that fail the format check never vote and are never combined into
        a guess: a plate is either read the same way, validly, several times, or
        it is not reported at all.
        """
        valid = [(p, c) for p, c, ok in self.reads[engine] if ok]
        if not valid:
            return None
        score = defaultdict(float)
        for p, c in valid:
            score[p] += c
        plate = max(score, key=score.get)
        agree = [c for p, c in valid if p == plate]
        counts = Counter(p for p, _ in valid)
        runner_up = max((n for p, n in counts.items() if p != plate), default=0)
        return {"plate": plate, "confidence": sum(agree) / len(agree), "votes": len(agree),
                "runner_up_votes": runner_up,
                "agreement": score[plate] / sum(score.values()), "valid_reads": len(valid),
                "reads": len(self.reads[engine])}

    def final(self):
        """Best answer across engines: most agreeing votes, then confidence."""
        options = [(e, r) for e, r in self.result.items() if r]
        if not options:
            return None
        engine, r = max(options, key=lambda er: (er[1]["votes"], er[1]["confidence"]))
        return {**r, "engine": engine}


class PlateVideoProcessor:
    def __init__(self, video, out_dir, model=DEFAULT_MODEL, ocr="plate", region="auto",
                 min_conf=0.1, det_conf=0.25, imgsz=1280, ocr_every=3, min_plate_width=36,
                 confirm_votes=3, min_agreement=0.4, stop_after=8, debug=False, sample_fps=None, output_video=None, device=None, write_video=True,
                 on_progress=None, on_preview=None, stop_event=None, engines=None, on_frame=None, pause_event=None):
        if region not in plate_rules.REGIONS:
            raise ValueError(f"region must be one of {plate_rules.REGIONS}")
        self.video, self.out_dir, self.model_path = video, out_dir, model
        self.ocr_choice, self.region = ocr, region
        self.min_conf, self.det_conf, self.imgsz = min_conf, det_conf, imgsz
        self.ocr_every, self.min_plate_width = ocr_every, min_plate_width
        self.confirm_votes, self.min_agreement, self.stop_after = confirm_votes, min_agreement, stop_after
        self.device, self.write_video = device, write_video
        self.on_progress, self.on_preview = on_progress, on_preview
        # on_frame(annotated_bgr, frame_index, total, fps): used by the live viewer.
        self.on_frame = on_frame
        self.debug = debug
        self.sample_fps = sample_fps
        self.output_video = output_video
        self.step = 1               # process every step-th frame; set from the video's fps in run()
        self.global_votes = False   # count votes per plate text instead of per track (sparse sampling)
        self.plate_hits = defaultdict(list)  # plate -> [(frame, confidence, track id)] of valid reads
        self.debug_rows = []
        self.pause_event = pause_event or threading.Event()
        self.stop_event = stop_event or threading.Event()
        self.engines = engines
        self.tracks = {}

    def confirmed(self, track):
        """The plate a track is confirmed as, or None. The only thing ever shown.

        Enough identical valid reads, a fair share of the vote, and clearly ahead
        of the next-best plate: a plate read "AP05JEO" 7 times and "AP05JED" 3
        times is AP05JEO, where a strict majority rule used to throw it away.
        """
        final = track.final()
        if not final:
            return None
        canonical = self.canonical(final["plate"])
        if self.global_votes:
            # Sparse sampling: a car moves too far between samples for the tracker
            # to keep one id, so the same plate arrives as several one-read tracks.
            # Valid reads of the same plate text are pooled across all of them.
            hits = self.plate_hits.get(canonical, ())
            if len(hits) >= self.confirm_votes:
                return {**final, "plate": canonical, "votes": len(hits),
                        "confidence": sum(c for _, c, _ in hits) / len(hits)}
            return None
        if canonical != final["plate"] and len(self.plate_hits.get(canonical, ())) >= self.confirm_votes:
            return {**final, "plate": canonical}
        if (final["votes"] >= self.confirm_votes
                and final["agreement"] >= self.min_agreement
                and final["votes"] >= 2 * final["runner_up_votes"]):
            return final
        return None

    # A misread differs from the real plate by a substituted character or two
    # (W->M, 6->5, H->M) and is seen at the same moment, on the same car.
    MISREAD_MAX_CHARS = 2
    MISREAD_WINDOW_S = 3.0

    def canonical(self, plate):
        """The plate a read really is: itself, or a stronger near-identical plate.

        Checked after extraction, against everything else read so far. If another
        valid plate of the same length is at most two characters different, was
        read within a few seconds of this one, and has more reads, this read is
        taken to be a misread of it. "CE61MYL" x3 next to "CE61WYL" x9 is one
        car, not two.
        """
        hits = self.plate_hits.get(plate)
        if not hits:
            return plate
        window = self.MISREAD_WINDOW_S * getattr(self, "fps", 30.0)
        frames = [f for f, _, _ in hits]
        best, best_n = plate, len(hits)
        for other, other_hits in self.plate_hits.items():
            if (other == plate or len(other) != len(plate) or len(other_hits) <= best_n
                    or sum(a != b for a, b in zip(plate, other)) > self.MISREAD_MAX_CHARS):
                continue
            if any(abs(f - g) <= window for f in frames for g, _, _ in other_hits):
                best, best_n = other, len(other_hits)
        return best

    # -- setup ---------------------------------------------------------------

    def _load(self):
        if not os.path.isfile(self.model_path):
            raise RuntimeError(
                f"YOLO plate weights not found at {self.model_path} — download them in PowerShell "
                "(see testing/README.md)"
            )
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError("ultralytics is not installed — in PowerShell: python -m pip install ultralytics") from exc
        import torch

        if self.device is None:
            self.device = 0 if torch.cuda.is_available() else "cpu"
        self.model = YOLO(self.model_path)
        if self.engines is None:
            self.engines, errors = load_engines(self.ocr_choice, gpu=self.device != "cpu")
            if not self.engines:
                raise RuntimeError("; ".join(f"{k}: {v}" for k, v in errors.items()))
            self.engine_errors = errors
        else:
            self.engine_errors = {}

    def _writer(self, path, fps, w, h):
        # mp4v only: avc1 needs an OpenH264 DLL on Windows and prints a wall of
        # errors without it. The Testing page plays the original video, not this.
        for codec in ("mp4v",):
            writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*codec), fps, (w, h))
            if writer.isOpened():
                return writer, codec
            writer.release()
        return None, None

    # -- main loop -------------------------------------------------------------

    def run(self):
        self._load()
        cap = cv2.VideoCapture(self.video)
        if not cap.isOpened():
            raise RuntimeError(f"cannot open video: {self.video}")
        fps = self.fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        if self.sample_fps:
            self.step = max(1, round(fps / self.sample_fps))
        # Below ~5 processed frames a second ByteTrack cannot follow a car from
        # one sample to the next, so votes are pooled by plate text instead.
        self.global_votes = self.step >= 6
        w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        os.makedirs(os.path.join(self.out_dir, "crops"), exist_ok=True)
        video_path = self.output_video or os.path.join(self.out_dir, "annotated.mp4")
        writer, codec = (None, None)
        # Every frame is read: draw as we go. When sampling, the video is drawn
        # afterwards instead (see _render), at full frame rate and with the
        # final plates — a 2 fps slideshow is no use for checking the result.
        if self.write_video and self.step == 1:
            writer, codec = self._writer(video_path, fps, w, h)

        boxes_by_frame = {}
        started = time.time()
        idx = -1
        cancelled = False
        try:
            while True:
                while self.pause_event.is_set() and not self.stop_event.is_set():
                    time.sleep(0.05)
                if self.stop_event.is_set():
                    cancelled = True
                    break
                # Skipped frames are only grabbed, never decoded — that is where
                # the time goes, so sampling 1 frame in 30 is ~30x less work.
                if not cap.grab():
                    break
                idx += 1
                if idx % self.step:
                    continue
                ok, frame = cap.retrieve()
                if not ok:
                    break
                boxes = self._process_frame(frame, idx, w, h)
                if boxes:
                    boxes_by_frame[idx] = boxes
                annotated = self._draw(frame, boxes) if (writer or self.on_preview or self.on_frame) else None
                if writer:
                    writer.write(annotated)
                if self.on_frame:
                    elapsed = time.time() - started
                    self.on_frame(annotated, idx, total, (idx + 1) / elapsed if elapsed else 0.0)
                if self.on_preview and (idx // self.step) % max(1, 3 // self.step) == 0:
                    small = cv2.resize(annotated, (960, int(h * 960 / w))) if w > 960 else annotated
                    ok_j, jpg = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 75])
                    if ok_j:
                        self.on_preview(jpg.tobytes())
                if self.on_progress and (idx // self.step) % max(1, 10 // self.step) == 0:
                    elapsed = time.time() - started
                    self.on_progress({"frame": idx + 1, "total": total,
                                      "fps": round((idx + 1) / elapsed, 1) if elapsed else 0,
                                      "tracks": self.summary(fps, live=True)})
        finally:
            cap.release()
            if writer:
                writer.release()

        if self.write_video and self.step > 1 and not cancelled:
            codec, rendered = self._render(video_path, fps, w, h, total, boxes_by_frame, started)
            if rendered is not None:
                # Every frame, labelled with the final plate — what the web page overlays.
                boxes_by_frame = rendered

        results = {
            "video": os.path.basename(self.video),
            "annotated_video": video_path if self.write_video else None,
            "width": w, "height": h, "fps": fps, "frames": idx + 1, "total_frames": total,
            "region": self.region, "ocr": self.ocr_choice,
            "engines": [e.name for e in self.engines], "engine_errors": self.engine_errors,
            "device": str(self.device), "annotated_codec": codec, "cancelled": cancelled,
            "seconds": round(time.time() - started, 1),
            "tracks": self.summary(fps),
            "tracked_plates": len(self.tracks),
            "processed_frames": idx // self.step + 1 if idx >= 0 else 0,
            "sample_step": self.step, "pooled_votes": self.global_votes,
            "rules": {"confirm_votes": self.confirm_votes, "min_agreement": self.min_agreement,
                      "ocr_every": self.ocr_every,
                      "min_conf": self.min_conf},
        }
        self._save(results, boxes_by_frame)
        return results

    def _process_frame(self, frame, idx, w, h):
        if self.global_votes:
            # Sparse sampling: ByteTrack only starts a track once an object is
            # matched in two consecutive frames, and a second apart a car never
            # is — so every plate after the first frame went untracked and
            # unread. Detect only; each box is its own one-frame "track" and
            # the reads are pooled by plate text (see confirmed()).
            res = self.model.predict(frame, conf=self.det_conf, imgsz=self.imgsz,
                                     device=self.device, verbose=False)[0]
            if res.boxes is None or len(res.boxes) == 0:
                return []
            start = max(self.tracks, default=0) + 1
            pairs = zip(res.boxes.xyxy.tolist(), range(start, start + len(res.boxes)))
        else:
            res = self.model.track(frame, persist=True, tracker="bytetrack.yaml", conf=self.det_conf,
                                   imgsz=self.imgsz, device=self.device, verbose=False)[0]
            if res.boxes is None or res.boxes.id is None:
                return []
            pairs = zip(res.boxes.xyxy.tolist(), res.boxes.id.int().tolist())
        out = []
        for (x1, y1, x2, y2), tid in pairs:
            track = self.tracks.get(tid) or self.tracks.setdefault(tid, Track(tid, idx))
            track.last = idx
            track.seen += 1
            out.append([tid, int(x1), int(y1), int(x2), int(y2)])
            self._maybe_read(track, frame, (x1, y1, x2, y2), idx, w, h)
        return out

    def _maybe_read(self, track, frame, box, idx, w, h):
        x1, y1, x2, y2 = pad_box(*box, w, h)
        if x2 - x1 < self.min_plate_width or y2 - y1 < 8:
            return
        crop = frame[y1:y2, x1:x2]
        quality = (x2 - x1) * (y2 - y1) * min(sharpness(crop), 400.0) / 400.0
        if quality > track.best_quality:
            track.best_quality, track.best_crop = quality, crop.copy()

        final = self.confirmed(track)
        if final and final["votes"] >= self.stop_after:
            return  # settled; spend the OCR time on plates still in doubt
        if idx - track.last_ocr < self.ocr_every * self.step:
            return
        if track.attempts >= 2 and quality < track.best_quality * 0.6:
            return  # a worse view than one already read

        track.last_ocr = idx
        track.attempts += 1
        for engine in self.engines:
            # Variants are tried in order and the first valid read wins; if none
            # is valid, the most confident read is still recorded (it cannot
            # vote, but it shows up in the debug output and the evaluation).
            best, tried = None, []
            for variant, text, conf in engine.read_all(crop):
                plate = plate_rules.repair(text, self.region)
                valid = plate_rules.plausible(plate, self.region) and conf >= self.min_conf
                tried.append((variant, text, plate, conf, valid))
                if valid:
                    best = (plate, conf, True)
                    break
                if len(plate) >= 4 and (best is None or conf > best[1]):
                    best = (plate, conf, False)
            if self.debug:
                self._debug(track, idx, engine.name, crop, tried)
            if best is None:
                continue
            track.reads[engine.name].append(best)
            if best[2]:
                self.plate_hits[best[0]].append((idx, best[1], track.id))
            track.result[engine.name] = track.vote(engine.name)

    def _debug(self, track, idx, engine, crop, tried):
        folder = os.path.join(self.out_dir, "debug", f"track_{track.id:04d}")
        os.makedirs(folder, exist_ok=True)
        top = next((t for t in tried if t[4]), max(tried, key=lambda t: t[3], default=None))
        label = f"{top[2]}_{top[3]:.2f}{'_OK' if top[4] else ''}" if top else "NOREAD"
        cv2.imwrite(os.path.join(folder, f"f{idx:05d}_{engine}_{label}.jpg"), crop)
        for variant, text, plate, conf, valid in tried or [("-", "", "", 0.0, False)]:
            self.debug_rows.append({"frame": idx, "seconds": round(idx / self.fps, 2), "track": track.id,
                                    "engine": engine, "variant": variant, "raw": text, "repaired": plate,
                                    "confidence": round(conf, 3), "valid": valid,
                                    "crop_w": crop.shape[1], "crop_h": crop.shape[0]})

    def _draw(self, frame, boxes):
        """Confirmed plates get a green box and their text; anything else only a
        thin grey box, so tracking is visible but no unconfirmed guess is shown."""
        labelled = []
        for tid, x1, y1, x2, y2 in boxes:
            final = self.confirmed(self.tracks[tid])
            labelled.append((final["plate"] if final else None, (x1, y1, x2, y2)))
        return self._draw_labels(frame.copy(), labelled)

    def _draw_labels(self, img, labelled):
        for plate, (x1, y1, x2, y2) in labelled:
            if not plate:
                cv2.rectangle(img, (x1, y1), (x2, y2), UNREAD, 1)
                continue
            cv2.rectangle(img, (x1, y1), (x2, y2), CONFIRMED, 2)
            text = plate_rules.pretty(plate, self.region)
            (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
            ty = max(y1 - 6, th + 6)
            cv2.rectangle(img, (x1, ty - th - 6), (x1 + tw + 8, ty + 4), CONFIRMED, -1)
            cv2.putText(img, text, (x1 + 4, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2, cv2.LINE_AA)
        return img

    def _panel(self, img, plates):
        """Running list of the plates read so far, top-left."""
        shown = plates[-12:]
        height = 40 + 30 * len(shown)
        overlay = img.copy()
        cv2.rectangle(overlay, (0, 0), (300, height), (15, 23, 42), -1)
        cv2.addWeighted(overlay, 0.75, img, 0.25, 0, img)
        cv2.putText(img, f"Plates read: {len(plates)}", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.75,
                    (255, 255, 255), 2, cv2.LINE_AA)
        for i, text in enumerate(shown):
            cv2.putText(img, text, (12, 60 + 30 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.75, CONFIRMED, 2, cv2.LINE_AA)

    @staticmethod
    def _match(prev, boxes):
        """Carry plate labels from the previous frame's boxes to this frame's.

        Frames are 1/30 s apart, so a plate moves a few pixels: each box takes
        the label of the nearest previous box whose centre is within half a
        plate width. Greedy, closest pairs first, each previous box used once.
        """
        pairs = []
        for i, (x1, y1, x2, y2) in enumerate(boxes):
            cx, cy, bw = (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1
            for j, (plate, (px1, py1, px2, py2)) in enumerate(prev):
                d = ((cx - (px1 + px2) / 2) ** 2 + (cy - (py1 + py2) / 2) ** 2) ** 0.5
                if d <= 0.5 * max(bw, px2 - px1):
                    pairs.append((d, i, j))
        labels, used_i, used_j = [None] * len(boxes), set(), set()
        for d, i, j in sorted(pairs):
            if i in used_i or j in used_j:
                continue
            used_i.add(i)
            used_j.add(j)
            labels[i] = prev[j][0]
        return labels

    def _render(self, path, fps, w, h, total, boxes_by_frame, started):
        """Second pass: every frame, boxes from YOLO, labels from the final result.

        Plates were read on the sampled frames only. Here YOLO runs on every
        frame so boxes follow the cars smoothly, and each box is labelled with
        the confirmed (self-corrected) plate of the sampled detection it
        connects to, frame by frame. OCR does not run again.
        """
        writer, codec = self._writer(path, fps, w, h)
        if writer is None:
            return None, None
        rendered = {}
        plate_of = {}
        for tid, t in self.tracks.items():
            final = self.confirmed(t)
            plate_of[tid] = final["plate"] if final else None
        first_seen = {}
        cap = cv2.VideoCapture(self.video)
        prev, idx = [], -1
        try:
            while not self.stop_event.is_set():
                ok, frame = cap.read()
                if not ok:
                    break
                idx += 1
                if idx in boxes_by_frame:
                    raw = [(tid, (x1, y1, x2, y2)) for tid, x1, y1, x2, y2 in boxes_by_frame[idx]]
                    boxes = [b for _, b in raw]
                    carried = self._match(prev, boxes)
                    labels = [plate_of.get(tid) or carried[i] for i, (tid, _) in enumerate(raw)]
                else:
                    res = self.model.predict(frame, conf=self.det_conf, imgsz=self.imgsz,
                                             device=self.device, verbose=False)[0]
                    boxes = ([tuple(int(v) for v in b) for b in res.boxes.xyxy.tolist()]
                             if res.boxes is not None else [])
                    labels = self._match(prev, boxes)
                prev = list(zip(labels, boxes))
                for plate in labels:
                    if plate and plate not in first_seen:
                        first_seen[plate] = idx
                if prev:
                    rendered[idx] = [[plate, *box] for plate, box in prev]
                img = self._draw_labels(frame, prev)
                self._panel(img, [plate_rules.pretty(p, self.region)
                                  for p, _ in sorted(first_seen.items(), key=lambda kv: kv[1])])
                writer.write(img)
                if self.on_preview and idx % 3 == 0:
                    small = cv2.resize(img, (960, int(h * 960 / w))) if w > 960 else img
                    ok_j, jpg = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 75])
                    if ok_j:
                        self.on_preview(jpg.tobytes())
                if self.on_progress and idx % 30 == 0:
                    elapsed = time.time() - started
                    self.on_progress({"frame": idx + 1, "total": total, "stage": "video",
                                      "fps": round((idx + 1) / elapsed, 1) if elapsed else 0,
                                      "tracks": self.summary(fps)})
        finally:
            cap.release()
            writer.release()
        return codec, rendered

    # -- output ----------------------------------------------------------------

    def summary(self, fps, live=False):
        """Confirmed plates only, one row per plate.

        ByteTrack can lose a plate behind another car and pick it up again under
        a new id; two tracks confirmed as the same plate are one vehicle, so they
        are merged rather than listed twice.
        """
        rows = {}
        for t in sorted(self.tracks.values(), key=lambda t: t.first):
            final = self.confirmed(t)
            if not final:
                continue
            plate = final["plate"]
            row = rows.get(plate)
            if row is None:
                rows[plate] = {
                    "id": t.id, "ids": [t.id], "plate": plate,
                    "display": plate_rules.pretty(plate, self.region),
                    "confirmed": True, "valid": True,
                    "confidence": round(final["confidence"], 3), "votes": final["votes"],
                    "agreement": round(final["agreement"], 3), "engine": final["engine"],
                    "by_engine": {e: ({"plate": r["plate"], "confidence": round(r["confidence"], 3),
                                       "votes": r["votes"], "valid": True} if r else None)
                                  for e, r in t.result.items()},
                    "first_frame": t.first, "last_frame": t.last,
                    "frames_seen": t.seen, "ocr_attempts": t.attempts,
                    "_best": t.best_quality, "_crop_id": t.id,
                }
                continue
            row["ids"].append(t.id)
            if not self.global_votes:  # pooled votes already count every track
                row["votes"] += final["votes"]
            row["confidence"] = round(max(row["confidence"], final["confidence"]), 3)
            row["first_frame"] = min(row["first_frame"], t.first)
            row["last_frame"] = max(row["last_frame"], t.last)
            row["frames_seen"] += t.seen
            row["ocr_attempts"] += t.attempts
            if t.best_quality > row["_best"]:
                row["_best"], row["_crop_id"] = t.best_quality, t.id
        out = []
        for row in sorted(rows.values(), key=lambda r: r["first_frame"]):
            crop_id = row.pop("_crop_id")
            row.pop("_best")
            row["merged_misreads"] = {p: len(h) for p, h in self.plate_hits.items()
                                      if p != row["plate"] and self.canonical(p) == row["plate"]}
            row["first_seconds"] = round(row["first_frame"] / fps, 2)
            row["last_seconds"] = round(row["last_frame"] / fps, 2)
            row["crop"] = f"crops/track_{crop_id}.jpg"
            out.append(row)
        return out

    def _save(self, results, boxes_by_frame):
        if self.debug and self.debug_rows:
            with open(os.path.join(self.out_dir, "debug", "reads.csv"), "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=list(self.debug_rows[0]))
                w.writeheader()
                w.writerows(self.debug_rows)
        for t in self.tracks.values():
            if t.best_crop is not None and self.confirmed(t):
                cv2.imwrite(os.path.join(self.out_dir, "crops", f"track_{t.id}.jpg"), t.best_crop)
        with open(os.path.join(self.out_dir, "results.json"), "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        with open(os.path.join(self.out_dir, "boxes.json"), "w", encoding="utf-8") as f:
            # frames: {index: [[track id | plate text | null, x1, y1, x2, y2], ...]}.
            # "labels" says which: ids when every frame was tracked, plate text
            # when the video was rendered from sampled reads.
            labelled = bool(boxes_by_frame) and isinstance(next(iter(boxes_by_frame.values()))[0][0], (str, type(None)))
            json.dump({"fps": results["fps"], "width": results["width"], "height": results["height"],
                       "labels": "plate" if labelled else "track", "frames": boxes_by_frame},
                      f, separators=(",", ":"))
        with open(os.path.join(self.out_dir, "results.csv"), "w", newline="", encoding="utf-8") as f:
            cols = ["id", "plate", "display", "confirmed", "valid", "confidence", "votes", "engine",
                    "first_seconds", "last_seconds", "frames_seen", "ocr_attempts"]
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(results["tracks"])


def main():
    ap = argparse.ArgumentParser(description="Track and read number plates in a video file.")
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", default=None, help="output folder (default testing/output/<video name>)")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="YOLO plate detector .pt")
    ap.add_argument("--ocr", default="plate", choices=("plate", "easyocr", "tesseract", "all"),
                    help="plate = fast-plate-ocr (trained on plates); all = run every engine and compare")
    ap.add_argument("--region", default="auto", choices=plate_rules.REGIONS,
                    help="auto = valid UK or Indian plates; uk / in = only that country; any = loose")
    ap.add_argument("--min-conf", type=float, default=0.1, help="OCR reads below this cannot vote")
    ap.add_argument("--det-conf", type=float, default=0.25, help="YOLO detection threshold")
    ap.add_argument("--imgsz", type=int, default=1280, help="YOLO input size; 1280 keeps small plates")
    ap.add_argument("--ocr-every", type=int, default=3, help="frames between OCR attempts per plate")
    ap.add_argument("--confirm-votes", type=int, default=None,
                    help="identical valid reads needed before a plate is shown (default 3, or 2 below 5 sample fps)")
    ap.add_argument("--min-agreement", type=float, default=0.4,
                    help="share of a plate's valid reads that must agree on the winner")
    ap.add_argument("--sample-fps", type=float, default=None,
                    help="process only this many frames per second of video (e.g. 1); default every frame")
    ap.add_argument("--cpu", action="store_true", help="force CPU")
    ap.add_argument("--no-video", action="store_true", help="skip writing annotated.mp4")
    ap.add_argument("--output-video", default=None,
                    help="where to save the annotated video (default <out>/annotated.mp4)")
    ap.add_argument("--show", action="store_true",
                    help="popup window with the live tracking and a plate list (space pauses, q stops)")
    args = ap.parse_args()
    if args.confirm_votes is None:
        args.confirm_votes = 2 if args.sample_fps and args.sample_fps < 5 else 3

    name = os.path.splitext(os.path.basename(args.video))[0]
    out = args.out or os.path.join(DEFAULT_OUT, "".join(c if c.isalnum() else "_" for c in name)[:60])

    stage = {"last": "start"}

    def progress(p):
        current = p.get("stage", "read")
        if current != stage["last"]:
            print("reading plates…" if current == "read" else "\nwriting annotated video (every frame)…")
            stage["last"] = current
        pct = f"{100 * p['frame'] / p['total']:.0f}%" if p["total"] else ""
        found = len(p["tracks"])
        print(f"\rframe {p['frame']}/{p['total']} {pct}  {p['fps']} fps  confirmed plates: {found}   ",
              end="", flush=True)

    proc = PlateVideoProcessor(args.video, out, model=args.model, ocr=args.ocr, region=args.region,
                               min_conf=args.min_conf, det_conf=args.det_conf, imgsz=args.imgsz,
                               ocr_every=args.ocr_every, confirm_votes=args.confirm_votes,
                               min_agreement=args.min_agreement, sample_fps=args.sample_fps,
                               device="cpu" if args.cpu else None,
                               write_video=not args.no_video, output_video=args.output_video,
                               on_progress=progress)
    if args.show:
        from live_viewer import LiveViewer

        results = LiveViewer(proc, out).run()
        if results is None:
            return
    else:
        results = proc.run()
    print()
    if results["engine_errors"]:
        print("engines unavailable:", results["engine_errors"])
    print(f"done in {results['seconds']}s on {results['device']} -> {out}")
    if results.get("annotated_video"):
        print(f"annotated video: {results['annotated_video']}")
    print(f"{len(results['tracks'])} valid plates confirmed out of {results['tracked_plates']} tracked")
    print(f"{'plate':<10} {'conf':>5} {'votes':>5}  {'engine':<9} time")
    for t in results["tracks"]:
        print(f"{t['display']:<10} {t['confidence']:>5.2f} {t['votes']:>5}  {t['engine']:<9} "
              f"{t['first_seconds']:.1f}-{t['last_seconds']:.1f}s")


if __name__ == "__main__":
    main()
