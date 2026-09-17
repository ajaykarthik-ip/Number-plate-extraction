#!/usr/bin/env python3
"""Run the plate pipeline headless on a video and score it against ground truth.

    python testing\\evaluate.py --video "C:\\path\\clip.mp4"

Reads every frame (OCR on every frame by default), then reports:

    captured   ground-truth plates the pipeline confirmed exactly
    missed     ground-truth plates it never confirmed — with the reason
    wrong      plates it confirmed that are not in the ground truth

Ground truth lives in testing/ground_truth/<video name>.txt, one plate per line
(see the file for the format). Nothing is shown on screen; results are printed
and saved next to the run's other output as evaluation.txt / evaluation.json.

To re-score a finished run without processing the video again:

    python testing\\evaluate.py --video "C:\\path\\clip.mp4" --results testing\\output\\<name>\\results.json
"""

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

import plate_rules  # noqa: E402
from plate_video import DEFAULT_MODEL, DEFAULT_OUT, PlateVideoProcessor  # noqa: E402


def safe_name(video):
    stem = os.path.splitext(video.replace("\\", "/").rsplit("/", 1)[-1])[0]
    return "".join(c if c.isalnum() else "_" for c in stem)[:60]


def load_truth(path):
    """(scored plates {plate: note}, reference-only plates {plate: note})."""
    scored, reference = {}, {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            target = scored
            if line.startswith("?"):
                target, line = reference, line[1:].strip()
            body, _, note = line.partition("#")
            parts = body.split()
            if not parts:
                continue
            plate = plate_rules.clean(parts[0])
            seen = parts[1] if len(parts) > 1 else ""
            target[plate] = (seen + "  " + note.strip()).strip()
    return scored, reference


def distance(a, b):
    """Levenshtein distance — how many character edits turn one plate into the other."""
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def nearest(plate, candidates, max_dist=2):
    best = min(candidates, key=lambda c: distance(plate, c), default=None)
    if best is not None and distance(plate, best) <= max_dist:
        return best, distance(plate, best)
    return None, None


def raw_reads(proc):
    """Every OCR read of every track, including ones that never got confirmed."""
    reads = {}
    for t in proc.tracks.values():
        for engine_reads in t.reads.values():
            for plate, conf, valid in engine_reads:
                r = reads.setdefault(plate, {"count": 0, "valid": valid, "tracks": set()})
                r["count"] += 1
                r["tracks"].add(t.id)
    return reads


def why_missed(plate, reads, confirm_votes):
    if not reads:
        return "no raw reads available (scored from saved results)"
    exact = reads.get(plate)
    if exact:
        return (f"read correctly {exact['count']}x across {len(exact['tracks'])} detection(s)/track(s), "
                f"but not confirmed (needs {confirm_votes}+ agreeing reads)")
    close = sorted(((distance(plate, p), -r["count"], p) for p, r in reads.items()
                    if distance(plate, p) <= 2))
    if close:
        d, neg, p = close[0]
        return f"only misread — closest read {plate_rules.pretty(p)} ({-neg}x, {d} char off)"
    return "never read — not detected, too small, or OCR returned nothing usable"


def main():
    ap = argparse.ArgumentParser(description="Score plate reading on a video against ground truth.")
    ap.add_argument("--video", required=True)
    ap.add_argument("--truth", help="ground-truth file (default testing/ground_truth/<video name>.txt)")
    ap.add_argument("--results", help="score an existing results.json instead of running the video")
    ap.add_argument("--out", help="output folder (default testing/output/<video name>_eval)")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--ocr", default="plate", choices=("plate", "easyocr", "tesseract", "all"))
    ap.add_argument("--region", default="auto", choices=plate_rules.REGIONS)
    ap.add_argument("--ocr-every", type=int, default=1, help="frames between OCR attempts per plate (1 = every frame)")
    ap.add_argument("--sample-fps", type=float, default=None,
                    help="process only this many frames per second of video (e.g. 1); default every frame")
    ap.add_argument("--confirm-votes", type=int, default=None,
                    help="agreeing valid reads to confirm a plate (default 3, or 2 when --sample-fps is below 5)")
    ap.add_argument("--min-agreement", type=float, default=0.4)
    ap.add_argument("--min-conf", type=float, default=0.1)
    ap.add_argument("--imgsz", type=int, default=1280)
    ap.add_argument("--save-video", action="store_true", help="also write annotated.mp4 (slower)")
    ap.add_argument("--debug", action="store_true",
                    help="save every OCR crop + reads.csv under <out>/debug to see why plates fail")
    ap.add_argument("--cpu", action="store_true")
    args = ap.parse_args()
    if args.confirm_votes is None:
        args.confirm_votes = 2 if args.sample_fps and args.sample_fps < 5 else 3

    name = safe_name(args.video)
    truth_path = args.truth or os.path.join(HERE, "ground_truth", f"{name}.txt")
    if not os.path.isfile(truth_path):
        sys.exit(f"no ground truth at {truth_path} — create it (one plate per line) or pass --truth")
    truth, reference = load_truth(truth_path)

    reads = {}
    if args.results:
        with open(args.results, encoding="utf-8") as f:
            results = json.load(f)
        out = os.path.dirname(os.path.abspath(args.results))
        confirm_votes = results.get("rules", {}).get("confirm_votes", args.confirm_votes)
    else:
        out = args.out or os.path.join(DEFAULT_OUT, f"{name}_eval")
        started = time.time()

        def progress(p):
            pct = 100 * p["frame"] / p["total"] if p["total"] else 0
            elapsed = time.time() - started
            eta = elapsed / p["frame"] * (p["total"] - p["frame"]) if p["frame"] and p["total"] else 0
            print(f"\rframe {p['frame']:>5}/{p['total']}  {pct:5.1f}%  {p['fps']:>5} fps  "
                  f"confirmed {len(p['tracks']):>3}  eta {eta / 60:4.1f} min   ", end="", flush=True)

        print(f"video : {args.video}")
        print(f"truth : {truth_path} ({len(truth)} plates scored, {len(reference)} reference-only)")
        print(f"rules : ocr={args.ocr} region={args.region} ocr_every={args.ocr_every} "
              f"sample_fps={args.sample_fps or 'all'} "
              f"confirm_votes={args.confirm_votes} min_agreement={args.min_agreement} "
              f"min_conf={args.min_conf}")
        print("loading YOLO + OCR…")
        proc = PlateVideoProcessor(
            args.video, out, model=args.model, ocr=args.ocr, region=args.region,
            min_conf=args.min_conf, imgsz=args.imgsz, ocr_every=args.ocr_every,
            confirm_votes=args.confirm_votes, min_agreement=args.min_agreement,
            device="cpu" if args.cpu else None, write_video=args.save_video, on_progress=progress,
            debug=args.debug, sample_fps=args.sample_fps,
        )
        results = proc.run()
        print()
        reads = raw_reads(proc)
        confirm_votes = args.confirm_votes

    confirmed = {t["plate"]: t for t in results["tracks"]}
    captured = sorted(p for p in truth if p in confirmed)
    missed = sorted(p for p in truth if p not in confirmed)
    # A confirmed plate that contains a reference-only fragment (e.g. "LT60WNA"
    # for a plate whose first letters are always hidden) can be neither proved
    # right nor wrong, so it is kept out of both counts.
    unverifiable = sorted(p for p in confirmed if p not in truth and any(r in p for r in reference))
    wrong = sorted(p for p in confirmed if p not in truth and p not in unverifiable)

    n_truth = len(truth)
    recall = len(captured) / n_truth if n_truth else 0.0
    scored_confirmed = len(captured) + len(wrong)
    precision = len(captured) / scored_confirmed if scored_confirmed else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

    lines = []
    say = lines.append
    say("=" * 72)
    say(f"PLATE READING EVALUATION — {results.get('video', os.path.basename(args.video))}")
    say("=" * 72)
    say(f"frames processed : {results.get('frames')} / {results.get('total_frames')}"
        f"   in {results.get('seconds')} s on {results.get('device')}"
        + (f"  ({results['frames'] / results['seconds']:.1f} fps)" if results.get("seconds") else ""))
    if results.get("sample_step", 1) > 1:
        say(f"sampled          : every {results['sample_step']} frames -> {results.get('processed_frames')} frames"
            f" read{'  (votes pooled by plate text)' if results.get('pooled_votes') else ''}")
    say(f"plate detections : {results.get('tracked_plates', '?')}"
        + ("  (one per box — no tracking when sampling sparsely)" if results.get("pooled_votes") else "  tracks"))
    say(f"ground truth     : {n_truth} readable plates")
    say("")
    say(f"CAPTURED  {len(captured):>3} / {n_truth}   recall    {recall:6.1%}")
    say(f"MISSED    {len(missed):>3} / {n_truth}")
    say(f"WRONG     {len(wrong):>3}        precision {precision:6.1%}   (confirmed plates that are not real)")
    say(f"                    F1        {f1:6.1%}")
    if unverifiable:
        say(f"UNVERIFIABLE {len(unverifiable)}  (confirmed, but the real plate is partly hidden in the video)")

    say("")
    say(f"-- every extracted plate, checked against the video ({len(confirmed)}) " + "-" * 14)
    say(f"  {'time':>11}  {'extracted':<10}  {'result':<13} {'real plate':<10}  votes  conf")
    for t in sorted(confirmed.values(), key=lambda t: t["first_seconds"]):
        p = t["plate"]
        if p in truth:
            verdict, real = "CORRECT", plate_rules.pretty(p)
        elif p in unverifiable:
            verdict, real = "CAN'T VERIFY", "hidden"
        else:
            near, d = nearest(p, list(truth))
            verdict, real = ("WRONG", plate_rules.pretty(near)) if near else ("WRONG", "not in video")
        say(f"  {t['first_seconds']:>5.1f}-{t['last_seconds']:<5.1f}  {t['display']:<10}  {verdict:<13} {real:<10}"
            f"  {t['votes']:>5}  {t['confidence']:.2f}")

    say("")
    say(f"-- captured ({len(captured)}) " + "-" * 50)
    for p in captured:
        t = confirmed[p]
        say(f"  OK    {plate_rules.pretty(p):<10}  votes {t['votes']:>3}  conf {t['confidence']:.2f}  "
            f"at {t['first_seconds']:.1f}-{t['last_seconds']:.1f}s   (truth {truth[p]})")
        if t.get("merged_misreads"):
            say("        self-corrected misreads: " + ", ".join(
                f"{plate_rules.pretty(m)} x{n}" for m, n in t["merged_misreads"].items()))

    say("")
    say(f"-- missed ({len(missed)}) " + "-" * 52)
    for p in missed:
        say(f"  MISS  {plate_rules.pretty(p):<10}  {why_missed(p, reads, confirm_votes)}")
        say(f"        truth: {truth[p]}")

    say("")
    say(f"-- wrong ({len(wrong)}) " + "-" * 53)
    for p in wrong:
        t = confirmed[p]
        near, d = nearest(p, list(truth) + list(reference))
        kind = (f"misread of {plate_rules.pretty(near)} ({d} char off)" if near
                else "not in the ground truth at all")
        say(f"  WRONG {plate_rules.pretty(p):<10}  votes {t['votes']:>3}  conf {t['confidence']:.2f}  "
            f"at {t['first_seconds']:.1f}-{t['last_seconds']:.1f}s   {kind}")

    if reference:
        say("")
        say(f"-- reference only, not scored ({len(reference)}) " + "-" * 30)
        for p, note in reference.items():
            hit = next((c for c in confirmed if p in c), None)
            say(f"  ?     {p:<10}  {'confirmed as ' + plate_rules.pretty(hit) if hit else 'not confirmed':<28} {note}")
    say("=" * 72)

    report = "\n".join(lines)
    print(report)

    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "evaluation.txt"), "w", encoding="utf-8") as f:
        f.write(report + "\n")
    with open(os.path.join(out, "evaluation.json"), "w", encoding="utf-8") as f:
        json.dump({
            "video": results.get("video"), "truth_file": truth_path,
            "settings": vars(args), "rules": results.get("rules"),
            "frames": results.get("frames"), "seconds": results.get("seconds"),
            "truth_count": n_truth, "captured": captured, "missed": missed, "wrong": wrong,
            "unverifiable": unverifiable,
            "self_corrected": {t["plate"]: t.get("merged_misreads") for t in results["tracks"]
                               if t.get("merged_misreads")},
            "recall": round(recall, 4), "precision": round(precision, 4), "f1": round(f1, 4),
            "missed_reasons": {p: why_missed(p, reads, confirm_votes) for p in missed},
        }, f, indent=2)
    print(f"saved: {os.path.join(out, 'evaluation.txt')}")


if __name__ == "__main__":
    main()
