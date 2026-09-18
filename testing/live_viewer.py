"""Popup window that shows plate tracking live while a video is read.

Built on Tkinter + Pillow instead of cv2.imshow: EasyOCR pulls in
opencv-python-headless, which has no window support and shadows the normal
OpenCV, so an OpenCV window fails on a machine that has EasyOCR installed.
Tkinter ships with Python and Pillow is already a dependency, so this needs
nothing extra.

The video is read on a worker thread; the window only ever shows the latest
annotated frame, so a slow screen never slows the reading down.

    Space  pause / resume        Q or Esc  stop (what was read is still saved)
    Click a plate in the list to see the sharpest crop it was read from.
"""

import os
import queue
import threading
import tkinter as tk
from tkinter import ttk

import cv2
from PIL import Image, ImageTk

PANEL_WIDTH = 380


class LiveViewer:
    def __init__(self, proc, out_dir):
        self.proc, self.out_dir = proc, out_dir
        self.frames = queue.Queue(maxsize=1)
        self.result = None
        self.error = None
        self.closing = False

        self.root = tk.Tk()
        self.root.title(f"Plate tracking — {os.path.basename(proc.video)}")
        self.root.configure(bg="#0f172a")
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        self.max_w = max(640, min(1280, sw - PANEL_WIDTH - 80))
        self.max_h = max(360, sh - 200)

        proc.on_frame = self._push
        proc.pause_event = threading.Event()
        self._build()

    # -- worker side -----------------------------------------------------------

    def _push(self, annotated, idx, total, fps):
        """Runs on the worker thread: shrink and convert here, not in the GUI."""
        h, w = annotated.shape[:2]
        scale = min(self.max_w / w, self.max_h / h, 1.0)
        view = cv2.resize(annotated, (int(w * scale), int(h * scale))) if scale < 1 else annotated
        rgb = cv2.cvtColor(view, cv2.COLOR_BGR2RGB)
        tracks = self.proc.summary(1.0, live=True)
        item = (rgb, idx, total, fps, tracks)
        try:
            self.frames.put_nowait(item)
        except queue.Full:
            try:
                self.frames.get_nowait()  # drop the stale frame, keep the newest
            except queue.Empty:
                pass
            self.frames.put_nowait(item)

    def _work(self):
        try:
            self.result = self.proc.run()
        except Exception as exc:  # noqa: BLE001 - shown in the window
            self.error = exc

    # -- window ----------------------------------------------------------------

    def _build(self):
        style = ttk.Style(self.root)
        style.configure("Treeview", rowheight=24, font=("Consolas", 10))
        style.configure("Treeview.Heading", font=("Segoe UI", 9, "bold"))

        top = tk.Frame(self.root, bg="#0f172a")
        top.pack(side="top", fill="x", padx=10, pady=8)
        self.pause_btn = ttk.Button(top, text="Pause (space)", command=self.toggle_pause)
        self.pause_btn.pack(side="left")
        ttk.Button(top, text="Stop (q)", command=self.stop).pack(side="left", padx=6)
        ttk.Button(top, text="Open output folder", command=self.open_output).pack(side="left")
        self.status = tk.Label(top, text="Loading YOLO and EasyOCR — the first run downloads OCR weights…",
                               fg="#e2e8f0", bg="#0f172a", font=("Segoe UI", 10))
        self.status.pack(side="left", padx=12)
        self.progress = ttk.Progressbar(top, length=200, maximum=1000)
        self.progress.pack(side="right")

        body = tk.Frame(self.root, bg="#0f172a")
        body.pack(side="top", fill="both", expand=True, padx=10, pady=(0, 10))

        self.video = tk.Label(body, bg="#020617", width=self.max_w // 8, height=self.max_h // 16)
        self.video.pack(side="left", fill="both", expand=True)

        side = tk.Frame(body, bg="#0f172a", width=PANEL_WIDTH)
        side.pack(side="right", fill="y", padx=(10, 0))
        side.pack_propagate(False)

        tk.Label(side, text="Plates", fg="#f8fafc", bg="#0f172a",
                 font=("Segoe UI", 12, "bold")).pack(anchor="w")
        tk.Label(side, text=f"only valid plates confirmed by {self.proc.confirm_votes}+ identical reads",
                 fg="#94a3b8", bg="#0f172a", font=("Segoe UI", 9)).pack(anchor="w", pady=(0, 6))

        cols = ("id", "plate", "votes", "conf")
        self.tree = ttk.Treeview(side, columns=cols, show="headings", height=18)
        for c, label, width, anchor in (("id", "#", 50, "e"), ("plate", "Plate", 150, "w"),
                                        ("votes", "Votes", 70, "e"), ("conf", "Conf", 70, "e")):
            self.tree.heading(c, text=label)
            self.tree.column(c, width=width, anchor=anchor, stretch=False)
        self.tree.tag_configure("confirmed", foreground="#15803d")
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", lambda e: self.show_crop())

        tk.Label(side, text="Sharpest crop of the selected plate", fg="#94a3b8", bg="#0f172a",
                 font=("Segoe UI", 9)).pack(anchor="w", pady=(8, 2))
        self.crop = tk.Label(side, bg="#020617", height=6)
        self.crop.pack(fill="x")

        self.root.bind("<space>", lambda e: self.toggle_pause())
        self.root.bind("q", lambda e: self.stop())
        self.root.bind("<Escape>", lambda e: self.stop())
        self.root.protocol("WM_DELETE_WINDOW", self.close)

    def toggle_pause(self):
        ev = self.proc.pause_event
        if ev.is_set():
            ev.clear()
            self.pause_btn.config(text="Pause (space)")
        else:
            ev.set()
            self.pause_btn.config(text="Resume (space)")

    def stop(self):
        self.proc.pause_event.clear()
        self.proc.stop_event.set()
        self.status.config(text="Stopping — saving what was read…")

    def close(self):
        self.closing = True
        self.stop()

    def open_output(self):
        if os.path.isdir(self.out_dir) and hasattr(os, "startfile"):
            os.startfile(self.out_dir)

    def show_crop(self):
        sel = self.tree.selection()
        if not sel:
            return
        track = self.proc.tracks.get(int(sel[0]))
        crop = track.best_crop if track else None
        if crop is None:
            return
        h, w = crop.shape[:2]
        scale = min((PANEL_WIDTH - 10) / w, 110 / h)
        img = cv2.cvtColor(cv2.resize(crop, (max(1, int(w * scale)), max(1, int(h * scale))),
                                      interpolation=cv2.INTER_CUBIC), cv2.COLOR_BGR2RGB)
        self._crop_img = ImageTk.PhotoImage(Image.fromarray(img))
        self.crop.config(image=self._crop_img, height=0)

    def _update_tree(self, tracks):
        # Rebuilding the list on every frame flickers and resets the scroll;
        # only redraw when a plate, vote count or status actually changed.
        sig = tuple((t["plate"], t["votes"]) for t in tracks)
        if sig == getattr(self, "_tree_sig", None):
            return
        self._tree_sig = sig
        selected = self.tree.selection()
        self.tree.delete(*self.tree.get_children())
        for t in reversed(tracks):  # newest at the top
            self.tree.insert("", "end", iid=str(t["id"]), tags=("confirmed",),
                             values=(t["id"], t["display"], t["votes"], f"{t['confidence']:.2f}"))
        keep = [s for s in selected if self.tree.exists(s)]
        if keep:
            self.tree.selection_set(keep)

    def _poll(self):
        item = None
        try:
            while True:
                item = self.frames.get_nowait()
        except queue.Empty:
            pass
        if item:
            rgb, idx, total, fps, tracks = item
            self._frame_img = ImageTk.PhotoImage(Image.fromarray(rgb))
            self.video.config(image=self._frame_img, width=rgb.shape[1], height=rgb.shape[0])
            confirmed = len(tracks)
            paused = " · PAUSED" if self.proc.pause_event.is_set() else ""
            if not self.proc.stop_event.is_set():
                self.status.config(text=f"Frame {idx + 1}/{total} · {fps:.1f} fps · "
                                        f"{confirmed} confirmed{paused}")
            if total:
                self.progress["value"] = int(1000 * (idx + 1) / total)
            self._update_tree(tracks)

        if self.worker.is_alive():
            self.root.after(15, self._poll)
            return
        if self.closing:
            self.root.destroy()
            return
        if self.error:
            self.status.config(text=f"Failed: {self.error}", fg="#fca5a5")
        elif self.result:
            r = self.result
            confirmed = len(r["tracks"])
            self._update_tree(r["tracks"])
            word = "Stopped" if r["cancelled"] else "Done"
            self.status.config(text=f"{word} in {r['seconds']}s · {confirmed} confirmed plates · "
                                    f"saved to testing\\output — close the window when finished")
            self.progress["value"] = 1000 if not r["cancelled"] else self.progress["value"]
            self.pause_btn.state(["disabled"])

    def run(self):
        """Blocks until the window is closed. Returns the results, or None on failure."""
        self.worker = threading.Thread(target=self._work, daemon=True)
        self.worker.start()
        self.root.after(50, self._poll)
        self.root.mainloop()
        self.worker.join(timeout=30)
        if self.error:
            print(f"failed: {self.error}")
        return self.result
