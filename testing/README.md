# Testing — number plates from recorded video

A test bench that runs separately from the live gate. It reads number plates
from a video file and writes a video with every plate labelled:

```
sampled frame (2 per second) -> YOLO11 plate detector -> crop
      -> fast-plate-ocr (OCR model trained on number plates)
      -> position repair (O/0, I/1, …) -> format check (UK / India)
      -> votes pooled by plate text -> misread correction -> confirmed plates
      -> second pass: detect on every frame, label with the confirmed plates
```

It doesn't import or change `bridge.py`. It borrows the Indian plate rules from
`anpr.py` read-only. It runs on its own port (8090) and has its own page at
`/testing`.

**Measured on the sample video** (60 s of 1080p UK traffic, 28 readable plates,
`--sample-fps 2`, GTX 1650):

- **27 / 28 plates captured** in about 20 seconds.
- **Before the misread correction:** 6 wrong plates, each a near-duplicate of a
  real one.
- **With the correction:** it merged all 6 misreads from that run in a test on
  the same reads. Re-run `evaluate.py` to confirm the result on the real video.
- **For comparison:** EasyOCR on every frame captured 5 / 28.

## Setup (Windows PowerShell)

Do this once, from the project folder.

### 1. Python packages

```powershell
cd C:\Users\Ajay\Desktop\Number-plate-extraction
python -m pip install -r testing\requirements-testing.txt
```

This installs:

- **`ultralytics`:** runs the YOLO detector.
- **`fast-plate-ocr[onnx]`:** the plate OCR model, on the CPU.
- **`easyocr` and `pytesseract`:** used only for `--ocr easyocr|tesseract|all`
  comparisons.

torch with CUDA and `opencv-python` are expected to be installed already. To
check that torch can use the GPU:

```powershell
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

### 2. Plate detector — YOLO11s weights (required, ~19 MB)

These weights are not in git (`testing/models/` is ignored). Download them into
exactly this path:

```powershell
mkdir testing\models
curl.exe -L -o testing\models\plate-yolo11s.pt "https://huggingface.co/morsetechlab/yolov11-license-plate-detection/resolve/main/license-plate-finetune-v1s.pt"
dir testing\models
```

`plate-yolo11s.pt` should be **19,173,715 bytes**.

- **Source:** YOLO11s fine-tuned on licence plates,
  [morsetechlab/yolov11-license-plate-detection](https://huggingface.co/morsetechlab/yolov11-license-plate-detection)
  (file `license-plate-finetune-v1s.pt`).
- **License:** the weights and ultralytics are both **AGPL-3.0**. That's fine
  for testing, but needs checking before shipping commercially.
- **Other detectors:** any single-class plate `.pt` works with `--model`.
  Larger variants from the same repo (`-v1m`, `-v1l`) are more accurate but
  slower.

Use `curl.exe`, not `curl`: in Windows PowerShell, `curl` is an alias for
`Invoke-WebRequest`.

### 3. Plate OCR model — fast-plate-ocr `cct-s-v2-global-model` (automatic)

Nothing to download by hand. The model (MIT license, trained on plates from 65+
countries) downloads the first time it's used, then works offline from the
local cache. To fetch it now and confirm it loads:

```powershell
python -c "from fast_plate_ocr import LicensePlateRecognizer as R; R('cct-s-v2-global-model'); print('plate OCR model ready')"
```

### 4. Optional

Tesseract is only needed for `--ocr tesseract` or `--ocr all`:

```powershell
winget install UB-Mannheim.TesseractOCR
```

## Quick start

**Labelled video of a clip:**

```powershell
python testing\plate_video.py --video "C:\Users\Ajay\Downloads\clip.mp4" --sample-fps 2 --output-video "C:\Users\Ajay\Desktop\plates_detected.mp4"
```

**Accuracy against an answer key** (see *Accuracy check* below):

```powershell
python testing\evaluate.py --video "C:\Users\Ajay\Downloads\License Plate Detection Test - Dev Drone Bhowmik (1080p, h264).mp4" --sample-fps 2
```

**Web page:** see *Testing page* below.

## Command line

`plate_video.py` flags:

| Flag | Default | |
| --- | --- | --- |
| `--sample-fps` | every frame | frames read per second of video. `2` is the tested setting; below 5, votes are pooled by plate text instead of tracking |
| `--output-video` | `<out>/annotated.mp4` | where to save the labelled video (full frame rate) |
| `--ocr` | `plate` | `plate` (fast-plate-ocr), `easyocr`, `tesseract`, or `all` to compare them |
| `--region` | `auto` | `auto` = valid UK **or** Indian plates, `uk`, `in`, `any` (loose) |
| `--confirm-votes` | `3` (`2` below 5 sample fps) | identical valid reads needed before a plate is shown |
| `--min-agreement` | `0.4` | share of a plate's valid reads that must agree on the winner (tracking mode) |
| `--min-conf` | `0.1` | OCR reads below this cannot vote |
| `--det-conf` | `0.25` | YOLO detection threshold |
| `--imgsz` | `1280` | YOLO input size; smaller is faster but loses distant plates |
| `--ocr-every` | `3` | frames between OCR attempts on the same plate (tracking mode) |
| `--model` | `testing/models/plate-yolo11s.pt` | YOLO plate detector weights |
| `--cpu` | off | force CPU |
| `--no-video` | off | skip writing the annotated video |
| `--show` | off | popup with live tracking and a plate list — **space** pauses, **q** stops |

### Live window

`--show` opens a popup that plays the video while it's being read. It shows
boxes, track ids and plates as they're found, plus a plate list on the side.
Click a plate in the list to see the sharpest crop it was read from, which is
the quickest way to check a read by eye.

**Space** pauses, and **Q** or **Esc** stops. Stopping still saves what was read.

It is built with Tkinter and Pillow, not `cv2.imshow`. That matters because
EasyOCR installs `opencv-python-headless`, which has no window support. The
window updates as fast as frames are processed: on a GTX 1650 that's slower
than real time while many plates are being OCR'd, and faster when the road is
empty.

Output goes to `testing/output/<name>/`:

| File | Contents |
| --- | --- |
| `results.json` | confirmed plates: votes, confidence, times, corrected misreads, settings |
| `results.csv` | confirmed plates, one row each |
| `boxes.json` | boxes for every frame with their plate label, used by the page overlay |
| `annotated.mp4` | full-frame-rate video with confirmed plates drawn on (mp4v, plays in VLC) |
| `crops/track_N.jpg` | the sharpest crop of each plate |

## Accuracy check (terminal, no window)

```powershell
python testing\evaluate.py --video "C:\Users\Ajay\Downloads\License Plate Detection Test - Dev Drone Bhowmik (1080p, h264).mp4"
```

This runs the whole video headless, with OCR on **every frame** by default
(`--ocr-every 1`). It compares the confirmed plates against the answer key in
`testing/ground_truth/<video name>.txt` and prints:

| Result | Meaning |
| --- | --- |
| **captured** | ground-truth plates confirmed exactly |
| **missed** | ground-truth plates never confirmed, with the reason: read correctly but too few agreeing reads, only misread, or never read |
| **wrong** | confirmed plates that aren't real, marked as a misread of a real plate or not in the video at all |
| **unverifiable** | confirmed plates whose real plate is partly hidden in the video, so they can't be checked |

It also prints recall, precision and F1, and saves the report as
`evaluation.txt` / `evaluation.json` in `testing/output/<video name>_eval/`.

The answer key for the sample video lists 28 fully readable plates, read by eye
from every second of the clip. Six partly hidden plates are listed with `?` and
are not scored. For a new video, write the same kind of file: one plate per line.

Other useful commands:

- **Change settings:** the same flags as `plate_video.py` work here, e.g.
  `--ocr all`, `--confirm-votes 2`, `--ocr-every 2`.
- **Re-score without reprocessing:** `--results testing\output\<name>_eval\results.json`
  scores an existing run again, for example after fixing the answer key.

## Testing page

Run these in two PowerShell windows:

```powershell
python testing\test_server.py --sample "C:\Users\Ajay\Downloads\License Plate Detection Test - Dev Drone Bhowmik (1080p, h264).mp4"
npm run dev
```

Then open `http://localhost:3000/testing`.

1. **Start a run:** upload a video or click **Run sample video**. Pick the OCR
   engine (default: the plate model), the plate format (default: UK + India),
   and how many **frames per second** to read (default 2).
2. **Watch it:** while it runs, the page shows annotated frames live. It reads
   plates first, then draws them on every frame.
3. **Check the result:** the video plays with smooth boxes and the final
   plates. Only confirmed plates are labelled; misreads are corrected and noted
   under each plate. Click a plate to jump to it in the video.
4. **Accuracy check:** if `testing/ground_truth/<video name>.txt` exists for the
   video, the page shows captured / missed / wrong counts and marks every plate
   **Correct**, **Wrong** (with the real plate) or **Can't verify**.
5. **Download:** the CSV and the annotated video (mp4v; plays in VLC).

Set `NEXT_PUBLIC_TEST_SERVER_URL` if the server isn't on `localhost:8090`.

## How a plate is decided

A plate is shown only if it's **valid and confirmed**. Anything else, including
single reads, disagreeing reads and impossible plates, is never displayed, not
even as a guess. Unconfirmed plates get only a thin grey box, so you can still
see the tracking.

1. **Repair:** each OCR read gets a position-based fix for letter/digit swaps,
   such as `O`→`0` where a digit belongs. A repair never adds or drops a
   character.
2. **Validate:** the read must be a plate that could actually have been issued:
   - **UK (current format, `AB12 CDE`):**
     - the region letter must be one DVLA issues (not I, J, Q, T, U or Z)
     - the second letter can't be I, Q or Z
     - the age code must already be issued: `02`–`yy` for March plates,
       `51`–`50+yy` for September plates
     - the last three letters can't include I or Q
     - so `AB50 CDE` and `QX12 ABC` are rejected
   - **India:**
     - a real state/UT code, then `DD L{1,3} DDDD`, or Bharat series `YY BH DDDD L{1,2}`
     - district `00` and number `0000` are rejected
   - **Auto:** accepts either format. They can't be confused, since a UK plate
     is 7 characters and an Indian one 9 or 10. Anything else, like a
     17-character VIN, is rejected.
3. **Vote:** only valid reads vote, weighted by confidence. A plate is
   **confirmed** when at least `--confirm-votes` (3) reads agree exactly, and
   the winning plate holds at least `--min-agreement` (60%) of the vote weight.
   Invalid reads are never merged into a "best guess".
4. **When OCR runs:** each tracked plate is OCR'd every `--ocr-every` frames,
   only when its crop is at least 36 px wide. After 8 agreeing votes, the track
   stops being OCR'd.
5. **Merging:** if the tracker loses a plate and picks it up under a new id,
   both tracks confirm the same plate and appear as one row.
6. **With `all`:** every engine reads every crop, and each engine votes
   separately. The engine with more agreeing votes wins.
