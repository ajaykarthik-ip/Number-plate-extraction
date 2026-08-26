# AutoGate NX — desktop shell

Electron wrapper that turns the Next.js UI into a Windows app. It contains
**no application code**: `npm run build` in `frontend/` exports the whole UI to
`frontend/out/` as plain HTML/CSS/JS, and this shell serves that folder from a
local static server and points a window at it.

Unlike PPE Monitor there is **no backend process** — this build is frontend-only
with hard-coded demo data, so the shell owns the entire lifecycle.

---

## Runtime behaviour

1. Serve the exported site over `http://127.0.0.1:<free port>` (port `0`, so the
   OS picks one and the app never collides with anything already listening).
2. Show `assets/loading.html` as a splash while that comes up.
3. Open a 1360×860 window at that URL; close the splash on `ready-to-show`.
4. Close the server on quit.

Where the site is read from:

| Build | Path |
|---|---|
| Packaged | `<resources>\site` (electron-builder `extraResources`) |
| Development | `..\frontend\out` |

Other behaviour worth knowing:

- **Single instance.** A second launch focuses the first window.
- **Failures are dialogs, not silence.** A missing export shows an error box
  naming the path it tried, then exits.
- **External links open in the system browser**, not a new Electron window.
- **`contextIsolation: true`, `nodeIntegration: false`**; `preload.js` exposes
  only an `autogateDesktop` bridge.
- Requests that try to escape the site folder (`../`) are rejected before they
  touch the filesystem.

### Env overrides

| Var | Default | Purpose |
|---|---|---|
| `AUTOGATE_APP_URL` | (bundled site) | Load this URL instead — e.g. `http://localhost:3000` to attach to `next dev` |
| `AUTOGATE_SITE_DIR` | see table above | Serve a different exported folder |

---

## Files

- `main.js` — window lifecycle, cleanup.
- `static-server.js` — serves the exported site; runnable on its own for a
  quick check without Electron: `node static-server.js ..\frontend\out`.
- `preload.js` — secure bridge (contextIsolation on, nodeIntegration off).
- `assets/loading.html` — splash shown while the server starts.
- `assets/icon.ico` — app/installer icon (`icon.png` is the source render).
- `package.json` — Electron + electron-builder; `win.target = [nsis, portable]`.

---

## Build / test — commands to run

### 0. The single command

From the **project root**:

```
npm run exe
```

That installs anything missing in `frontend/` and `desktop/`, exports the UI,
and packages both installers. Double-clicking `BUILD-EXE.bat` from File
Explorer runs the same thing with a Node check and a pause at the end.

Other root scripts:

| Command | Does |
|---|---|
| `npm run dev` | Next dev server on :3000 (browser) |
| `npm run app` | Export the UI and open it in the desktop window |
| `npm run exe` | Full build → installer + portable exe |
| `npm run exe:fast` | Export + `win-unpacked\` only, no installers — much quicker |

The steps below are the same thing done by hand, for when something breaks.

### 1. Install dependencies (needs internet — build machine only)

```
cd desktop
npm install
```

### 2. Dev smoke test

Export the UI first, then start the shell:

```
cd frontend
npm run build
cd ..\desktop
npm start
```

A window should open on the Gate Overview page.

To iterate on the UI instead, run `npm run dev` in `frontend/` and point the
shell at it:

```
cd desktop
set AUTOGATE_APP_URL=http://localhost:3000 && npm start
```

### 3. Produce the installer

```
cd desktop
npm run dist
```

Run this in an **elevated** PowerShell, or enable Developer Mode:
electron-builder needs symlink privilege to extract `winCodeSign`.

Output in `desktop\release\`:

| File | What it is |
|---|---|
| `AutoGateNX-Setup-1.0.0.exe` | Installer — per-user, choose install dir, desktop + start menu shortcuts |
| `AutoGateNX-Portable-1.0.0.exe` | Single file, runs with no install |
| `win-unpacked\` | The raw app folder, for debugging |

`npm run dist:dir` builds only `win-unpacked\` and skips the installers — much
faster when you just want to check the packaged app runs.

### Rebuilding after a UI change

The exported site is copied in at package time, so a UI change needs both steps:

```
cd frontend
npm run build
cd ..\desktop
npm run dist
```
