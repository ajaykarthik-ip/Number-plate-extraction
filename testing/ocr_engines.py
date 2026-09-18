"""OCR engines behind one interface, so a plate crop can be read by either.

Both engines get the same prepared crop. A plate from a 1080p overhead shot is
often under 30px tall, which is below what either recogniser was built for, so
the crop is enlarged and its contrast evened out first — without that step
Tesseract returns nothing on most of this footage.
"""

import os
import shutil

import cv2

from plate_rules import ALLOWLIST

# The UB-Mannheim installer puts tesseract.exe here and does not always add it
# to PATH, so a fresh install would otherwise look missing.
TESSERACT_CANDIDATES = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
)

TESSERACT_HEIGHT = 96
# EasyOCR's recogniser works on 64 px tall lines, so a crop is scaled to exactly
# that. Scaling further and letting it shrink back only adds interpolation blur.
EASYOCR_HEIGHT = 64


def _gray(crop):
    return cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop


def _to_height(gray, height):
    h = gray.shape[0]
    if not h or h == height:
        return gray
    scale = height / h
    interp = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
    return cv2.resize(gray, None, fx=scale, fy=scale, interpolation=interp)


def _unsharp(gray, amount=1.0):
    blur = cv2.GaussianBlur(gray, (0, 0), 1.2)
    return cv2.addWeighted(gray, 1 + amount, blur, -amount, 0)


def prepare(crop, height=TESSERACT_HEIGHT):
    """Grey, enlarged, contrast-equalised and sharpened — for Tesseract."""
    gray = _to_height(_gray(crop), height)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 8)).apply(gray)
    return _unsharp(gray)


def variants(crop):
    """A few versions of one crop, cheapest first.

    Plates are ~80 px wide here, so a single stroke decides W against O or T
    against L. No blur is applied anywhere — the old bilateral filter smoothed
    away exactly those strokes. Different lighting (headlight glare, a dark
    bumper) favours a different version, so more than one is offered and the
    caller keeps whichever reads as a valid plate.
    """
    gray = _to_height(_gray(crop), EASYOCR_HEIGHT)
    yield "sharp", _unsharp(gray)
    yield "clahe", _unsharp(cv2.createCLAHE(clipLimit=2.0, tileGridSize=(2, 6)).apply(gray))
    yield "plain", gray


class PlateModelEngine:
    """fast-plate-ocr: a recogniser trained only on cropped number plates.

    EasyOCR is a general scene-text model; on a clean 90x28 px UK plate it
    returned "M" or "Z" for most crops. This model was trained on plates from
    65+ countries, reads the whole plate in one pass, and runs in milliseconds
    on the CPU, so it needs no GPU setup.
    """

    name = "plate"
    MODEL = "cct-s-v2-global-model"

    def __init__(self, gpu=False):
        try:
            from fast_plate_ocr import LicensePlateRecognizer
        except ImportError as exc:
            raise RuntimeError(
                'fast-plate-ocr is not installed — in PowerShell: python -m pip install "fast-plate-ocr[onnx]"'
            ) from exc
        self.model = LicensePlateRecognizer(self.MODEL)
        self.rgb = None  # learnt on the first crop: some models take RGB, some grayscale

    def _run(self, img):
        return self.model.run(img, return_confidence=True)[0]

    def read_all(self, crop):
        pred = None
        if self.rgb is not False:
            try:
                pred = self._run(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
                self.rgb = True
            except Exception:
                if self.rgb:
                    return
                self.rgb = False
        if pred is None:
            try:
                pred = self._run(_gray(crop))
            except Exception:
                return
        text = getattr(pred, "plate", pred if isinstance(pred, str) else "")
        probs = getattr(pred, "char_probs", None)
        # Pad slots ("_") carry probabilities too; only real characters count.
        kept = [float(p) for ch, p in zip(text, probs if probs is not None else []) if ch.isalnum()]
        conf = min(kept) if kept else (1.0 if probs is None and text.strip("_") else 0.0)
        if text.strip("_ "):
            yield "model", text, conf

    def read(self, crop):
        return next(((t, c) for _, t, c in self.read_all(crop)), None)


class EasyOCREngine:
    """General-purpose OCR, kept for comparison with the plate model."""

    name = "easyocr"

    def __init__(self, gpu=True):
        import easyocr  # late: pulls in torch

        self.reader = easyocr.Reader(["en"], gpu=gpu, verbose=False)

    def read_all(self, crop):
        # readtext + greedy decoding: measured better on this footage than
        # recognize() on the whole crop with beam search (5/28 against 2/28).
        img = _unsharp(_to_height(_gray(crop), EASYOCR_HEIGHT))
        try:
            found = self.reader.readtext(img, allowlist=ALLOWLIST, paragraph=False)
        except Exception:
            return
        found = [f for f in found if f[1].strip()]
        if not found:
            return
        # Left to right, then top to bottom for two-row plates.
        found.sort(key=lambda f: (round(min(p[1] for p in f[0]) / (img.shape[0] / 2)), min(p[0] for p in f[0])))
        text = "".join(f[1] for f in found)
        conf = sum(f[2] * len(f[1]) for f in found) / max(sum(len(f[1]) for f in found), 1)
        yield "readtext", text, float(conf)

    def read(self, crop):
        return next(((t, c) for _, t, c in self.read_all(crop)), None)


class TesseractEngine:
    name = "tesseract"

    def __init__(self):
        import pytesseract

        cmd = shutil.which("tesseract") or next((p for p in TESSERACT_CANDIDATES if os.path.isfile(p)), None)
        if not cmd:
            raise RuntimeError(
                "tesseract.exe not found — install it in PowerShell with: winget install UB-Mannheim.TesseractOCR"
            )
        pytesseract.pytesseract.tesseract_cmd = cmd
        pytesseract.get_tesseract_version()  # fails loudly now rather than on the first crop
        self.pt = pytesseract
        # psm 7: treat the image as a single line of text.
        self.config = f"--oem 3 --psm 7 -c tessedit_char_whitelist={ALLOWLIST}"

    def read(self, crop):
        img = prepare(crop)
        # Tesseract wants dark text on a light background with a margin round it.
        _, binary = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        if binary.mean() < 127:
            binary = cv2.bitwise_not(binary)
        binary = cv2.copyMakeBorder(binary, 12, 12, 12, 12, cv2.BORDER_CONSTANT, value=255)
        try:
            data = self.pt.image_to_data(binary, config=self.config, output_type=self.pt.Output.DICT)
        except Exception:
            return None
        words = [(t, float(c)) for t, c in zip(data["text"], data["conf"]) if t.strip() and float(c) >= 0]
        if not words:
            return None
        text = "".join(t for t, _ in words)
        conf = sum(c * len(t) for t, c in words) / max(len(text), 1) / 100.0
        return text, conf

    def read_all(self, crop):
        got = self.read(crop)
        if got:
            yield "binary", *got


ENGINE_NAMES = ("plate", "easyocr", "tesseract")
ENGINES = {"plate": PlateModelEngine, "easyocr": EasyOCREngine, "tesseract": TesseractEngine}


def load_engines(choice, gpu=True):
    """Engines for one name, or 'all' to compare every one that loads. Returns (engines, errors)."""
    wanted = ENGINE_NAMES if choice in ("all", "both") else (choice,)
    engines, errors = [], {}
    for name in wanted:
        try:
            cls = ENGINES[name]
            engines.append(cls() if name == "tesseract" else cls(gpu=gpu))
        except Exception as exc:  # noqa: BLE001 - reported to the caller verbatim
            errors[name] = str(exc)
    return engines, errors
