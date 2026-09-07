#!/usr/bin/env python3
"""Plate reading for AutoGate NX.

This is the real reader: frames in, plate strings out. It runs locally on the
CPU — EasyOCR for the characters, OpenCV for everything before that — because a
gate has to keep working when the internet does not.

The order matters more than any single step. Running OCR on a whole 960x720
frame costs seconds and mostly finds the camera's own clock overlay, so the
frame is narrowed down first and read last:

    motion  ->  plate-shaped region  ->  OCR the crop  ->  format check

Everything here is deliberately conservative. A gate that opens for a plate it
misread is worse than one that misses a car and waits for the next frame, so a
read has to survive a format check and be seen twice before it counts.
"""

import re
import time

import cv2
import numpy as np

# Indian plates: two letters of state, two digits of district, one to three
# letters of series, four digits. Spacing and dashes vary by state and by who
# painted the plate, so they are stripped before this is applied.
PLATE_RE = re.compile(r"^[A-Z]{2}[0-9]{2}[A-Z]{1,3}[0-9]{4}$")

# Bharat-series plates read the other way round: year, BH, four digits, series.
BH_RE = re.compile(r"^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$")

ALLOWLIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

# Confusions that survive a good crop. Applied per position once the shape of
# the plate says which half of the alphabet belongs there, never blindly.
TO_DIGIT = str.maketrans({"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8", "G": "6", "T": "7"})
TO_ALPHA = str.maketrans({"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G", "4": "A"})

# Every state and union-territory code actually issued. The first two
# characters of a plate are drawn from this closed set, which makes them the
# one part of a read that can be checked against the world rather than against
# a pattern — "TM22CA9550" is the right *shape* for a plate, but no such state
# exists, and TM is one stroke away from TN.
STATE_CODES = {
    "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ",
    "HP", "HR", "JH", "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP",
    "MZ", "NL", "OD", "OR", "PB", "PY", "RJ", "SK", "TN", "TR", "TS", "UK",
    "UP", "WB",
}

# Letters the recogniser swaps for one another often enough to be worth a
# second guess at the state code, where a wrong letter is otherwise fatal.
NEAR_LETTERS = {
    "M": "NH", "N": "MH", "H": "MN", "T": "IJ", "I": "TJ", "J": "TI",
    "K": "RX", "R": "KP", "P": "RF", "D": "OQ", "O": "DQ", "G": "CO",
    "C": "GO", "S": "B", "B": "S", "U": "V", "V": "UY", "W": "VM", "L": "IE",
    "A": "R", "E": "FL", "F": "EP", "X": "KY", "Y": "XV", "Z": "S", "Q": "OD",
}


def clean(text):
    """Strip everything a plate cannot contain and upper-case the rest."""
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def repair(raw):
    """Fix character confusions using the position rules of an Indian plate.

    OCR sees shapes, not meaning: the letter O and the digit 0 are the same
    picture. The plate format says which one belongs in each position, so a
    read that is one substitution away from valid is repaired rather than
    thrown away — that single rule is the difference between reading most
    passing cars and reading almost none.
    """
    s = clean(raw)
    if len(s) < 9 or len(s) > 10:
        return s
    if BH_RE.match(s):
        return s
    # A read can have the right shape and still name a state that does not
    # exist. Returning early on the shape alone let "TM22CA9550" through
    # untouched — right shape, no such state, one letter away from TN.
    if PLATE_RE.match(s):
        return s if s[:2] in STATE_CODES else _fix_state(s)
    # Standard layout: LL DD L(1-3) DDDD. Series length is whatever is left
    # over once the fixed parts are accounted for.
    series = len(s) - 8
    if not 1 <= series <= 3:
        return s
    fixed = (
        s[0:2].translate(TO_ALPHA)
        + s[2:4].translate(TO_DIGIT)
        + s[4:4 + series].translate(TO_ALPHA)
        + s[4 + series:].translate(TO_DIGIT)
    )
    if not PLATE_RE.match(fixed):
        return s
    return fixed if fixed[:2] in STATE_CODES else _fix_state(fixed)


def _fix_state(plate):
    """Nudge an impossible state code onto a real one, if a single swap does it.

    Only an unambiguous repair is accepted: if two candidate states are equally
    reachable there is no way to choose between them, and inventing an answer
    at the gate is worse than declining to read the plate.
    """
    head, tail = plate[:2], plate[2:]
    # Nearest first: a code one letter out is a likelier reading than one that
    # needs both letters changed. "TM" is TN misread, not Jharkhand — and only
    # looking at two-letter swaps once the one-letter swaps come up empty is
    # what tells those apart.
    one_off = {a + head[1] for a in NEAR_LETTERS.get(head[0], "")} | {
        head[0] + b for b in NEAR_LETTERS.get(head[1], "")
    }
    for options in (one_off & STATE_CODES, _two_off(head) & STATE_CODES):
        if len(options) == 1:
            return options.pop() + tail
    return plate


def _two_off(head):
    return {
        a + b
        for a in NEAR_LETTERS.get(head[0], "")
        for b in NEAR_LETTERS.get(head[1], "")
    }


def plausible(plate):
    """A read is only offered up if it could be a plate someone was issued."""
    if BH_RE.match(plate):
        return True
    return bool(PLATE_RE.match(plate)) and plate[:2] in STATE_CODES


class PlateFinder:
    """Narrows a frame down to the handful of rectangles worth reading.

    Two cheap locators, both from OpenCV, because they fail on different
    pictures: the cascade wants a head-on plate at a decent size, the contour
    pass only wants a bright rectangle of roughly plate proportions and so
    still finds one at an angle. Whatever they return is a candidate, never an
    answer — the OCR decides.
    """

    # Plates are wider than they are tall; anything outside this is a window,
    # a bumper or a shadow.
    MIN_RATIO, MAX_RATIO = 1.7, 6.0
    MIN_AREA = 700
    # A plate never fills the shot. Without this the blackhat pass happily
    # returns the skyline as one candidate, and OCR then spends thirty seconds
    # on a rectangle that could not possibly be a plate.
    MAX_WIDTH_FRACTION = 0.55
    MAX_HEIGHT_FRACTION = 0.35
    # Reading is the expensive step, so only the best few are ever offered up.
    MAX_CANDIDATES = 4

    def __init__(self):
        self.cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_russian_plate_number.xml"
        )

    def candidates(self, gray):
        boxes = []
        if not self.cascade.empty():
            for (x, y, w, h) in self.cascade.detectMultiScale(gray, 1.1, 4, minSize=(60, 20)):
                boxes.append((int(x), int(y), int(w), int(h)))
        boxes.extend(self._by_contour(gray))
        height, width = gray.shape[:2]
        boxes = [
            b
            for b in boxes
            if b[2] <= width * self.MAX_WIDTH_FRACTION and b[3] <= height * self.MAX_HEIGHT_FRACTION
        ]
        return self._dedupe(boxes)[: self.MAX_CANDIDATES]

    def _by_contour(self, gray):
        """Plate glyphs are dense vertical strokes — that texture is the cue."""
        grad = cv2.morphologyEx(
            gray, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (17, 5))
        )
        _, thresh = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        closed = cv2.morphologyEx(
            thresh, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (19, 5))
        )
        found = []
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if h == 0 or w * h < self.MIN_AREA:
                continue
            if self.MIN_RATIO <= w / h <= self.MAX_RATIO:
                found.append((x, y, w, h))
        # Biggest first: on a street scene the nearest vehicle is the one at
        # the barrier, and reading it first keeps the queue in order.
        return sorted(found, key=lambda b: -b[2] * b[3])[:6]

    @staticmethod
    def _dedupe(boxes):
        """Both locators tend to find the same plate; keep one box per plate."""
        kept = []
        for box in boxes:
            x, y, w, h = box
            if any(abs(x - kx) < kw * 0.5 and abs(y - ky) < kh * 0.8 for kx, ky, kw, kh in kept):
                continue
            kept.append(box)
        return kept


def sharpen(crop):
    """Give the recogniser the cleanest version of a small, soft crop.

    A plate 30 pixels tall at the far end of a lane is under the size EasyOCR
    was trained for, so it is enlarged and its contrast equalised first. This
    is the step that turns an unreadable crop into a read.
    """
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    if gray.shape[0] < 64:
        scale = 64 / max(gray.shape[0], 1)
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    return cv2.bilateralFilter(gray, 7, 60, 60)


class Detector:
    """A trained plate detector, when one has been supplied.

    PlateFinder is edges and proportions, and it is honest about what that
    buys: on a camera looking down a street it finds railings, windows and
    kerbstones, and misses the plate. A model trained on plates does not — on
    the test frame here it put a box on both bikes the finder missed entirely.

    It is optional on purpose. The weights are a separate download and not
    everyone will want one, so this is used only when a path is handed in, and
    the classical finder stays the default.
    """

    def __init__(self, weights, confidence=0.25, image_size=1280):
        from ultralytics import YOLO  # optional dependency, imported on demand

        self.model = YOLO(weights)
        self.confidence = confidence
        self.image_size = image_size

    def candidates(self, bgr):
        found = self.model.predict(
            bgr, imgsz=self.image_size, conf=self.confidence, verbose=False
        )[0]
        boxes = []
        for box in found.boxes:
            x0, y0, x1, y1 = (int(v) for v in box.xyxy[0].tolist())
            boxes.append((x0, y0, x1 - x0, y1 - y0))
        return boxes


class Reader:
    """EasyOCR, loaded once and shared.

    Construction pulls ~100MB of weights off disk and takes a few seconds, so
    the bridge builds one of these at startup rather than per camera. The
    models are the ones EasyOCR caches in ~/.EasyOCR — no network at read time.
    """

    def __init__(self, gpu=False, model=None):
        import easyocr  # imported late: it drags in torch, which is slow to load

        self.ocr = easyocr.Reader(["en"], gpu=gpu, verbose=False)
        self.finder = PlateFinder()
        self.detector = Detector(model) if model else None

    def read_crop(self, crop):
        """Best (plate, confidence) from one candidate rectangle.

        readtext() rather than recognize(): a motorcycle plate is stacked in
        two rows, and the single-line recogniser reads such a crop as one
        smeared line and returns junk. Letting the detector find each row and
        assembling them in reading order is what makes two-line plates work.
        """
        if crop.size == 0:
            return None
        # OCR cost climbs with area, and past a point the extra pixels buy
        # nothing: a plate big enough to fill this much of the frame is already
        # far more legible than the recogniser needs. Capping the width is what
        # keeps a near vehicle from costing ten seconds a frame.
        if crop.shape[1] > self.MAX_CROP_WIDTH:
            scale = self.MAX_CROP_WIDTH / crop.shape[1]
            crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        prepared = sharpen(crop)
        try:
            found = self.ocr.readtext(prepared, allowlist=ALLOWLIST)
        except Exception:
            return None
        if not found:
            return None

        # Top to bottom, then left to right — the order the rows are read in.
        # A row is "the same line" when the boxes sit at about the same height,
        # which tolerates a plate photographed at an angle without merging its
        # two rows into one.
        pieces = []
        for box, text, conf in found:
            ys = [p[1] for p in box]
            xs = [p[0] for p in box]
            pieces.append((min(ys), max(ys), min(xs), str(text), float(conf)))
        pieces.sort(key=lambda p: (p[0], p[2]))
        rows = []
        for top, bottom, left, text, conf in pieces:
            height = bottom - top
            for row in rows:
                if abs(row["top"] - top) < height * 0.6:
                    row["items"].append((left, text, conf))
                    break
            else:
                rows.append({"top": top, "items": [(left, text, conf)]})

        # A crop is not always one plate: it can hold two parked bikes, or a
        # plate plus the camera's clock. Gluing everything found into a single
        # string turns those into nonsense, so each way the text could be split
        # is offered up and the format check decides which one was a plate.
        assembled = []
        for row in rows:
            ordered = sorted(row["items"])
            assembled.append(ordered)                      # one line on its own
            for item in ordered:
                assembled.append([item])                   # one fragment alone
        for first, second in zip(rows, rows[1:]):
            assembled.append(sorted(first["items"]) + sorted(second["items"]))  # stacked plate

        best = None
        for items in assembled:
            text = clean("".join(item[1] for item in items))
            scores = [item[2] for item in items]
            if not text or not scores:
                continue
            plate = repair(text)
            if not plausible(plate):
                continue
            confidence = sum(scores) / len(scores)
            if best is None or confidence > best[1]:
                best = (plate, confidence)
        return best

    # Plate-finding is tuned for a frame about this wide. The camera's own
    # frame is far larger, and searching it at full size is both slower and
    # worse — the kernels below stop matching the size of a plate's glyphs.
    SEARCH_WIDTH = 960
    # Widest crop worth handing to the recogniser; see read_crop.
    MAX_CROP_WIDTH = 640

    def read_frame(self, frame, zone=None, regions=None):
        """Every plate this frame can be made to give up.

        `zone` is the normalised rect the UI draws over the lane; outside it
        nothing is read, which is both faster and the point of drawing one.

        `regions` narrows it further to where something just moved.

        The search happens on a downscaled copy and the reading happens on the
        original pixels. That split matters more than anything else here: this
        camera is 2592 wide, so a plate across the street is 120px of real
        detail and only 45px in the preview the browser gets. Locating on the
        small copy keeps it fast; cropping from the big one is what makes the
        characters legible at all.
        """
        view, (ox, oy) = _crop_zone(frame, zone)
        if view.size == 0:
            return []

        # Motion regions arrive in frame coordinates; the zone may have moved
        # the origin, so they are pulled into the view's frame of reference and
        # anything outside the zone is dropped on the way.
        areas = []
        for (rx, ry, rw, rh) in regions or []:
            ax0, ay0 = max(0, rx - ox), max(0, ry - oy)
            ax1 = min(view.shape[1], rx - ox + rw)
            ay1 = min(view.shape[0], ry - oy + rh)
            if ax1 - ax0 > 20 and ay1 - ay0 > 20:
                areas.append((ax0, ay0, ax1 - ax0, ay1 - ay0))
        if not areas:
            areas = [(0, 0, view.shape[1], view.shape[0])]

        boxes = []
        for (ax, ay, aw, ah) in areas:
            patch = view[ay:ay + ah, ax:ax + aw]
            scale = min(1.0, self.SEARCH_WIDTH / patch.shape[1])
            search = patch if scale == 1.0 else cv2.resize(patch, None, fx=scale, fy=scale)
            if self.detector:
                # The model works from pixels, not edges, so it is given the
                # patch at its own resolution rather than the shrunken copy.
                for (x, y, w, h) in self.detector.candidates(patch):
                    boxes.append((ax + x, ay + y, w, h))
            else:
                gray = cv2.cvtColor(search, cv2.COLOR_BGR2GRAY)
                for box in self.finder.candidates(gray):
                    x, y, w, h = (round(v / scale) for v in box)
                    boxes.append((ax + x, ay + y, w, h))
            # The area itself is worth reading when it is already about the
            # size of a plate: the locator is a filter for big pictures, and
            # insisting on it here would throw away the region motion just
            # handed us. Anything larger is left to the locator, because
            # reading a whole vehicle at once finds its badges, not its plate.
            if aw <= self.MAX_CROP_WIDTH:
                boxes.append((ax, ay, aw, ah))

        results = []
        for (x, y, w, h) in boxes:
            pad = max(2, h // 6)
            x0, y0 = max(0, x - pad), max(0, y - pad)
            x1, y1 = min(view.shape[1], x + w + pad), min(view.shape[0], y + h + pad)
            hit = self.read_crop(view[y0:y1, x0:x1])
            if hit:
                results.append(
                    {
                        "plate": hit[0],
                        "confidence": round(hit[1], 3),
                        "box": [x0 + ox, y0 + oy, x1 - x0, y1 - y0],
                    }
                )
        # One plate can be found by both locators; keep the confident copy.
        best = {}
        for r in results:
            if r["plate"] not in best or r["confidence"] > best[r["plate"]]["confidence"]:
                best[r["plate"]] = r
        return sorted(best.values(), key=lambda r: -r["confidence"])


def _crop_zone(frame, zone):
    """Apply the UI's normalised detection rect. Returns the view and offset."""
    if not zone:
        return frame, (0, 0)
    h, w = frame.shape[:2]
    x0 = max(0, min(w - 1, int(zone.get("x", 0) * w)))
    y0 = max(0, min(h - 1, int(zone.get("y", 0) * h)))
    x1 = max(x0 + 1, min(w, x0 + int(zone.get("w", 1) * w)))
    y1 = max(y0 + 1, min(h, y0 + int(zone.get("h", 1) * h)))
    return frame[y0:y1, x0:x1], (x0, y0)


class MotionGate:
    """Answers one question: is anything moving worth looking at?

    OCR is the expensive part of this program by three orders of magnitude, so
    it should only run when something has changed. An empty lane costs a frame
    difference on a thumbnail; a car arriving costs a read.
    """

    def __init__(self, threshold=0.002):
        self.threshold = threshold
        self.prev = None

    WIDTH, HEIGHT = 320, 240

    def moved(self, frame):
        return bool(self.regions(frame))

    def regions(self, frame):
        """Where in the frame something is moving, in frame coordinates.

        This is the step that makes reading a distant plate possible at all.
        Searching a whole 2592-wide frame is slow and finds the skyline; a
        vehicle that has just driven in occupies a small part of it, and that
        part upscaled is a legible plate. So motion does double duty — it says
        *whether* to look, and it says *where*.
        """
        small = cv2.cvtColor(cv2.resize(frame, (self.WIDTH, self.HEIGHT)), cv2.COLOR_BGR2GRAY)
        small = cv2.GaussianBlur(small, (5, 5), 0)
        if self.prev is None:
            self.prev = small
            return []

        diff = cv2.absdiff(small, self.prev)
        self.prev = small
        _, mask = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
        if float((mask > 0).mean()) < self.threshold:
            return []
        # Close the gaps: a moving car breaks into several patches of change —
        # bonnet, windscreen, shadow — and the plate sits between them.
        mask = cv2.dilate(mask, np.ones((9, 9), np.uint8), iterations=2)

        scale_x = frame.shape[1] / self.WIDTH
        scale_y = frame.shape[0] / self.HEIGHT
        boxes = []
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if w * h < 120:  # a bird, a leaf, sensor noise
                continue
            boxes.append(
                (round(x * scale_x), round(y * scale_y), round(w * scale_x), round(h * scale_y))
            )
        # Largest first — the nearest vehicle covers the most pixels, and it is
        # the one at the barrier.
        return sorted(boxes, key=lambda b: -b[2] * b[3])[:3]


class Tracker:
    """Turns a stream of reads into one event per vehicle.

    A car in view for three seconds is read many times. Confirming a plate on
    the second sighting throws away the one-frame flukes that a single bad crop
    produces, and the hold-down afterwards stops the same car being logged over
    and over while it waits at the barrier.
    """

    def __init__(self, confirm=2, hold_seconds=25.0, memory=90.0):
        self.confirm = confirm
        self.hold = hold_seconds
        self.memory = memory
        self.seen = {}       # plate -> [count, first_seen, best_confidence]
        self.emitted = {}    # plate -> when it was last reported

    def offer(self, plate, confidence, now=None):
        """Returns the confidence to log, or None while the plate is unproven."""
        now = time.time() if now is None else now
        self._forget(now)

        last = self.emitted.get(plate)
        if last is not None and now - last < self.hold:
            return None

        count, first, best = self.seen.get(plate, (0, now, 0.0))
        count += 1
        best = max(best, confidence)
        self.seen[plate] = (count, first, best)
        if count < self.confirm:
            return None

        del self.seen[plate]
        self.emitted[plate] = now
        return best

    def _forget(self, now):
        self.seen = {p: v for p, v in self.seen.items() if now - v[1] < self.memory}
        self.emitted = {p: t for p, t in self.emitted.items() if now - t < self.hold * 2}
