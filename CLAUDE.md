# CLAUDE.md

## Installing dependencies — Windows PowerShell only

- **Never install anything inside WSL** — no `pip install`, `npm install`, `apt`,
  model downloads into WSL paths, or any other package/tool install from the
  WSL shell.
- All installs happen in **Windows PowerShell**, done **manually by the user**.
  When something is missing, stop and give the exact PowerShell command to run
  (e.g. `python -m pip install ultralytics`), then wait for them to confirm.
- **Never run `powershell.exe` / `cmd.exe` yourself** — not for installs, not
  for checks, not for builds or lint. Hand the user the commands instead and
  let them paste the output back. Watch for commands that install implicitly
  (`npx <pkg>` downloads a missing package; so do first runs that fetch
  weights).
- The project runs on Windows Python (`python` in PowerShell, 3.13, torch with
  CUDA on the GTX 1650), not WSL's `python3`.

## Layout

- `frontend/` + `desktop/` — AutoGate NX UI (Next.js, static export) and its
  Electron build. See `frontend/AGENTS.md` before touching Next.js code.
- `bridge.py` + `anpr.py` — live RTSP camera bridge and plate reader (port 8080).
- `testing/` — standalone video testing section: YOLO plate detection +
  tracking + OCR (Tesseract / EasyOCR) on a video file, served on port 8090,
  with its own page at `/testing`. It must not change the behaviour of
  `bridge.py`, `anpr.py` or the existing pages.
