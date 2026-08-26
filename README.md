# AutoGate NX

Vehicle access control for an IT park: every number plate entering or leaving is
read and matched against a tenant allow-list, and anything unregistered is
stopped at the barrier.

Two pieces live in this repo:

| Folder | What it is |
| --- | --- |
| `frontend/` + `desktop/` | **AutoGate NX** — the Next.js demo UI and its Windows desktop build |
| `app.py` | **Plate reader** — a Streamlit tool that reads plates from a photo with Gemini |

---

# Part 1 — AutoGate NX demo UI

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
| `/dashboard` | In-out flow by hour, pass-type donut, weekly trend, per-block parking occupancy |
| `/vehicles` | The allow-list — search, category filter, register a vehicle, revoke |
| `/alerts` | Every blocked unregistered plate, with **Issue pass** to add it to the allow-list |
| `/logs` | Full in/out history — search by plate, filter by allowed/blocked and direction |

Registering or revoking a vehicle updates React state live, so the demo reacts to
clicks during a pitch. It does **not** rewrite history: a newly-allowed plate still
shows its earlier "Blocked" row in the log, which is correct for an audit record.

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

# Part 2 — Plate reader (Streamlit + Gemini)

`app.py` reads vehicle number plates from a photo. Upload a car image and it
returns the plate number, a description of the vehicle, a confidence level, and any
characters it found ambiguous. This is the piece that would eventually feed the
AutoGate UI with real detections.

## Requirements

- Python 3.10 or newer
- A Gemini API key — free from [Google AI Studio](https://aistudio.google.com/apikey)

## Setup

In PowerShell, from this folder:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

If PowerShell blocks the activate script, allow it for the current user once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Using a virtual environment is optional — `pip install -r requirements.txt` on its
own works too.

Then add your API key. Open `app.py` and replace the placeholder on line 19:

```python
API_KEY = "replace-with-your-key"
```

Without this the app will fail with an authentication error. See
[API key](#api-key) for a way to avoid putting it in the file at all.

## Run

```powershell
streamlit run app.py
```

Streamlit opens `http://localhost:8501`. Upload a JPG, PNG, or WEBP of a car, then
click **Read plate**. `Ctrl+C` in the terminal stops it.

## How it works

`app.py` sends the uploaded image to Gemini with a prompt that asks it to
transcribe plates exactly, and with a JSON schema describing the expected output.
Temperature is `0`, and the prompt explicitly tells the model not to guess a
plausible plate or "correct" an unusual one — if it cannot read a plate, it returns
an empty result and explains why in the notes.

Images larger than 15 MB are downscaled automatically, since the API caps a request
containing inline image data at 20 MB.

## Model and free tier

The app uses `gemini-3.5-flash-lite`, which is free and reads plates accurately.

The Gemini free tier is limited to roughly **20 requests per day per model**, and
each model has its own separate quota. If you run out, either wait for the quota to
reset or switch `MODEL` at the top of `app.py`:

| Model | Notes |
| --- | --- |
| `gemini-3.5-flash-lite` | Current default. Fast, free. |
| `gemini-3.1-flash-lite` | Separate quota, so useful as a fallback. |
| `gemini-3.5-flash` | Stronger, but the same small free daily quota. |
| `gemini-3.7-flash` | Smartest, but frequently returns `503 high demand` on the free tier. |

## API key

`app.py` holds the key in the `API_KEY` constant at the top, which is fine for
local use. It ships with the placeholder `replace-with-your-key` so that a real key
is never committed to this repository.

Keep it that way — **a key committed to a public repo can be scraped and used by
anyone**, and Gemini keys are tied to your Google account's quota. If you ever do
commit one by accident, rotate it at
[Google AI Studio](https://aistudio.google.com/apikey).

The safest option is to keep the key out of the file entirely and read it from an
environment variable:

```python
import os
API_KEY = os.environ["GEMINI_API_KEY"]
```

Then set it in PowerShell before running the app:

```powershell
$env:GEMINI_API_KEY = "your-key-here"
streamlit run app.py
```

`$env:` variables last only for the current terminal session. To make it permanent:

```powershell
[Environment]::SetEnvironmentVariable("GEMINI_API_KEY", "your-key-here", "User")
```

## Troubleshooting

| Message | What it means |
| --- | --- |
| `API key not valid` / `401` / `403` | The placeholder is still in `app.py`. Add your real key. |
| `Free-tier quota hit` / `429 RESOURCE_EXHAUSTED` | Daily or per-minute limit reached. Wait, or switch model. |
| `503 UNAVAILABLE ... high demand` | The model is busy. Retry, or switch to a lite model. |
| `Cannot send a request, as the client has been closed` | Only happens if the Gemini client isn't held in a variable. The app already handles this. |

---

## Files

| Path | Purpose |
| --- | --- |
| `package.json` | Root scripts — `dev`, `build`, `app`, `exe`, `exe:fast` |
| `BUILD-EXE.bat` | Double-click wrapper around `npm run exe` |
| `frontend/src/app/` | The five pages |
| `frontend/src/components/` | Layout, gate panels, shared UI |
| `frontend/src/context/GateContext.jsx` | Allow-list, movement log, camera state, derived stats |
| `frontend/src/data/registry.js` | All hard-coded demo data |
| `desktop/main.js` | Electron window lifecycle |
| `desktop/static-server.js` | Serves the exported site; runs standalone for testing |
| `desktop/README.md` | Desktop build reference |
| `app.py` | Streamlit number plate reader |
| `requirements.txt` | Python dependencies |
