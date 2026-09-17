# Testing — plate tracking on recorded video

A test bench that runs separately from the live gate. It reads number plates from a
video file:

```
frame -> YOLO plate detector -> ByteTrack (one id per plate)
      -> crop -> OCR (EasyOCR / Tesseract) -> format repair
      -> vote across every read of that id -> one plate per vehicle
```

It doesn't import or change `bridge.py`. It borrows the Indian plate rules from
`anpr.py` read-only. It runs on its own port (8090) and has its own page at
`/testing`.

## Setup (Windows PowerShell)

```powershell
cd C:\Users\Ajay\Desktop\Number-plate-extraction
python -m pip install -r testing\requirements-testing.txt
winget install UB-Mannheim.TesseractOCR
New-Item -ItemType Directory -Force testing\models | Out-Null
Invoke-WebRequest "https://huggingface.co/morsetechlab/yolov11-license-plate-detection/resolve/main/license-plate-finetune-v1s.pt" -OutFile testing\models\plate-yolo11s.pt
```

The weights are YOLO11s fine-tuned on licence plates
([morsetechlab/yolov11-license-plate-detection](https://huggingface.co/morsetechlab/yolov11-license-plate-detection)).
The model and ultralytics are both **AGPL-3.0**, which is fine for testing but
needs checking before shipping commercially. Any other single-class plate `.pt`
works with `--model`.

## Command line

```powershell
python testing\plate_video.py --video "C:\Users\Ajay\Downloads\clip.mp4" --ocr easyocr --show
```

| Flag | Default | |
| --- | --- | --- |
| `--ocr` | `plate` | `plate` (fast-plate-ocr, a model trained on number plates), `easyocr`, `tesseract`, or `all` to compare them |
| `--region` | `auto` | `auto` = valid UK **or** Indian plates, `uk`, `in`, `any` (loose) |
| `--confirm-votes` | `3` | identical valid reads needed before a plate is shown |
| `--min-agreement` | `0.6` | share of a plate's valid reads that must agree on the winner |
| `--min-conf` | `0.3` | OCR reads below this are ignored |
| `--det-conf` | `0.25` | YOLO detection threshold |
| `--imgsz` | `1280` | YOLO input size; smaller is faster but loses distant plates |
| `--ocr-every` | `3` | frames between OCR attempts on the same plate |
| `--cpu` | off | force CPU |
| `--no-video` | off | skip writing `annotated.mp4` |
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
| `results.json` | every track: final plate, confidence, votes, per-engine reads, times |
| `results.csv` | the tracks that have a read |
| `boxes.json` | per-frame boxes, used by the page overlay |
| `annotated.mp4` | boxes and plate text drawn on the video |
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
