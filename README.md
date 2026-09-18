# AutoGate NX

Vehicle access control for an IT park: every number plate entering or leaving is
read and matched against a tenant allow-list, and anything unregistered is
stopped at the barrier.

Two pieces live in this repo:

| Folder | What it is |
| --- | --- |
| `frontend/` + `desktop/` | **AutoGate NX** — the Next.js demo UI and its Windows desktop build |
| `bridge.py` | **Camera bridge** — serves an RTSP camera as MJPEG, and reads plates off it |
| `anpr.py` | **Plate reader** — motion → plate finder → OCR → format check |

---

# AutoGate NX demo UI

A client-facing demo. All data is **hard-coded** in `frontend/src/data/registry.js`
— 10 registered vehicles across 5 tenant companies, 14 logged movements (3 of them
blocked), plus hourly, weekly and occupancy figures. There is no backend and no
camera connected yet; the camera panel is an honest "not connected" state with a
form to save an RTSP / HTTP / IP source.

## Run it

```powershell
npm run dev
```

Opens `http://localhost:3000`. First run needs `npm install` inside `frontend/`,
which `npm run exe` does for you.

## Pages

| Route | Shows |
| --- | --- |
| `/` Gate Overview | Inside now / entries / exits / blocked, camera connect panel, camera strip, recent movements |
| `/entry` Entry Gate | The gatehouse screen for one entry lane: the barrier state, the plate at it, and **Issue visitor pass** for one that is not registered |
| `/live` Live View | The camera picture with the scripted plate reads drawn over it, a detection zone you can drag, and the read feed |
| `/dashboard` | In-out flow by hour, pass-type donut, weekly trend, per-block parking occupancy |
| `/vehicles` | The allow-list — search, category filter, register a vehicle, revoke |
| `/alerts` | Every blocked unregistered plate, with **Issue pass** to add it to the allow-list |
| `/logs` | Full in/out history — search by plate, filter by allowed/blocked and direction |

Registering or revoking a vehicle updates React state live, so the demo reacts to
clicks during a pitch. It does **not** rewrite history: a newly-allowed plate still
shows its earlier "Blocked" row in the log, which is correct for an audit record.

## Connecting a real camera

A browser has no RTSP client, so an `rtsp://` URL cannot be shown to it however
it is bound. `bridge.py` closes that gap: it opens the camera with OpenCV and
re-serves the picture as multipart MJPEG, which an `<img>` renders natively.

```powershell
pip install -r requirements.txt
python bridge.py
```

Then paste the camera's own RTSP address into the form on Gate Overview — the
UI registers it with the bridge and plays the stream that comes back. The
picture appears in the camera tile, and again on `/live` with the detection
overlay:

```
rtsp://admin:PASSWORD@192.168.1.65:554/Streaming/Channels/102
```

An `http://` MJPEG address needs no bridge and is used directly.

| Detail | Notes |
| --- | --- |
| Channel `102` vs `101` | On a Hikvision-style camera `102` is the substream and is the right one for a live pane. `101` is the main stream — sharper, far heavier. |
| Password characters | Percent-encode them: `@` becomes `%40`, `#` becomes `%23`. |
| Bridge address | `http://localhost:8080`. Set `NEXT_PUBLIC_BRIDGE_URL` at build time to point elsewhere. |
| Options | `--port`, `--width` (downscale, default 960), `--quality` (JPEG, default 70), `--url` to bind one camera at startup, `--host 0.0.0.0` to serve other machines. |
| Endpoints | `POST /cameras` `{id, url}` registers one, `GET /stream/<id>`, `GET /snapshot/<id>`, `GET /health`, `DELETE /cameras/<id>`. |

The bridge holds one RTSP session per camera no matter how many tabs are
watching, reconnects on its own, and redacts credentials from its logs and
replies. It binds to `127.0.0.1` by default — on `0.0.0.0`, anyone who can reach
the port can ask it to open any RTSP URL.

Bound sources are kept in `localStorage`, and re-registered with the bridge on
load so they survive a bridge restart. Anything a browser cannot decode leaves
the pane dark with a message saying why.

## Plate reading

Live View reads real plates. `anpr.py` does the recognition and `bridge.py`
runs it against every camera it has bound, so the reads in the UI come off the
camera rather than out of a list — the demo plates are gone, and a lane with
nothing in it now logs nothing.

The order of the pipeline is the whole trick, because OCR is thousands of times
more expensive than everything around it:

```
frame (full resolution)
  -> motion         where did anything change? nothing moving, nothing read
  -> plate finder   which rectangles look like plates
  -> OCR            EasyOCR on those crops only
  -> format check   TN09BX4521 shape, and a state code that exists
  -> confirmation   the same plate twice before it is logged
```

Two details worth knowing before changing any of it:

* **Reading happens on the camera's own frame, never the preview.** The pane in
  the browser is downscaled to `--width` (960 by default); a plate across the
  lane is ~120px wide in the 2592-wide original and ~45px in that preview, and
  45px of plate reads as nothing. `Stream` keeps both for this reason.
* **A read is confirmed, not trusted.** It has to pass the format check, clear
  `--min-confidence`, and be seen twice (`anpr.Tracker`) before it reaches the
  log. Distant or angled plates do produce confident nonsense, and a single
  sighting is not evidence.

The UI polls `/reads/<camera>` for what has been found and decides about the
barrier itself, against the allow-list in the browser. The reader never has an
opinion about who may come in.

### Making it read well

Recognition is only as good as the pixels it gets, and framing matters far more
than any setting here:

* **Point the camera at a lane, not a landscape.** A plate needs roughly 100px
  of width to read reliably. At a barrier that is easy; across a street it is
  marginal, and reads get both rarer and wronger.
* **Draw the detection zone.** *Set detection area* on Live View sends the
  rectangle to the reader (`POST /zone/<camera>`), which then searches only
  there — faster, and it stops the reader picking up plates parked across the
  road.
* **Use channel `101`.** The substream (`102`, 640x360 here) has no detail to
  read. `--width` only affects the browser's picture, not the reading.
* **Add a trained detector if the built-in finder misses plates.** The built-in
  one is edges and proportions; in a wide shot it finds railings and kerbstones
  and misses plates. A trained model does much better:

  ```
  pip install ultralytics
  python bridge.py --model path/to/plate-model.pt
  ```

  Any YOLO `.pt` trained on plates works. Keep the weights outside the repo.
  The built-in finder is not switched off by loading one: it still runs on the
  patches the model returns nothing for, so a plate at an angle the model was
  never trained on has a second chance at being found.

### Reading knobs

| Flag | Default | What it does |
| --- | --- | --- |
| `--no-anpr` | off | Serve video only; the UI shows the picture and logs nothing |
| `--read-interval` | `0.4` | Seconds between reading passes while something is moving |
| `--min-confidence` | `0.35` | Reads below this are dropped |
| `--model` | none | Trained plate detector (`.pt`); needs `ultralytics` |
| `--gpu` | off | Run the recogniser on CUDA if it is there |

If the reader cannot be loaded at all, the bridge says so and carries on
serving video — the camera pane keeps working, and Live View shows **Reader
down** rather than pretending to watch.

## Build the Windows .exe

One command, from this folder:

```powershell
npm run exe
```

It installs anything missing, exports the UI to static HTML, and packages both
installers into `desktop\release\`:

| File | What it is |
| --- | --- |
| `AutoGateNX-Setup-1.0.0.exe` | Installer — per-user, choose install dir, desktop + start menu shortcuts |
| `AutoGateNX-Portable-1.0.0.exe` | Single file, runs with no install — the easier one to hand a client |

Or double-click `BUILD-EXE.bat` from File Explorer, which wraps the same command.

**Run it in an elevated PowerShell**, or turn on Developer Mode — electron-builder
needs symlink privilege to unpack `winCodeSign`. The first build downloads Electron
(~250 MB); later builds are offline and take about a minute.

### Other scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Next dev server on :3000 |
| `npm run build` | Export the UI to `frontend/out/` |
| `npm run app` | Export, then open it in the desktop window |
| `npm run exe` | Full build → installer + portable exe |
| `npm run exe:fast` | Export + `desktop\release\win-unpacked\` only, skipping the slow installer compression |

## How the desktop build works

`frontend/` exports to plain HTML/CSS/JS (`output: 'export'`), and the Electron
shell in `desktop/` serves that folder from a local static server on an
OS-assigned free port, then points a window at it. There is no backend process to
spawn — when a real ANPR service exists, either point `AUTOGATE_APP_URL` at it or
spawn it from `desktop/main.js`. See [`desktop/README.md`](desktop/README.md) for
the full lifecycle, env overrides and troubleshooting.

## Where to change things

| Want to change | File |
| --- | --- |
| Vehicles, tenants, logs, chart figures, cameras | `frontend/src/data/registry.js` |
| Park and gate names | same file, `PARK_NAME` / `GATE_NAME` |
| Signed-in user shown in the top bar | `frontend/src/components/layout/Navbar.jsx` |
| Nav items | `frontend/src/components/layout/Sidebar.jsx` |
| Colours, fonts, badge and input styles | `frontend/src/app/globals.css` |
| App icon and splash | `desktop/assets/` |

---

## Files

| Path | Purpose |
| --- | --- |
| `package.json` | Root scripts — `dev`, `build`, `app`, `exe`, `exe:fast` |
| `BUILD-EXE.bat` | Double-click wrapper around `npm run exe` |
| `frontend/src/app/` | The six pages |
| `frontend/src/components/` | Layout, gate panels, shared UI |
| `frontend/src/context/GateContext.jsx` | Allow-list, movement log, camera state, derived stats |
| `frontend/src/data/registry.js` | All hard-coded demo data |
| `desktop/main.js` | Electron window lifecycle |
| `desktop/static-server.js` | Serves the exported site; runs standalone for testing |
| `desktop/README.md` | Desktop build reference |
| `bridge.py` | RTSP → MJPEG bridge, and the reader's host |
| `anpr.py` | Plate recognition: motion, plate finder, OCR, format rules |
| `requirements.txt` | Python dependencies |
