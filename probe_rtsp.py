#!/usr/bin/env python3
"""Find the RTSP URL a camera actually answers on.

Disposable helper — not part of the app. Delete it once the camera is bound.

    python probe_rtsp.py rtsp://admin:pass@192.168.1.65:554/Streaming/Channels/102
        test exactly that URL

    python probe_rtsp.py 192.168.1.65 admin yourpassword
        try the common path for every major brand and report which one works

Whatever it prints as WORKS is what goes in the camera form in the UI.
"""

import os
import socket
import sys

os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
# A dead path otherwise hangs for ~30s each; this keeps the sweep short.
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] += "|stimeout;6000000"

import cv2  # noqa: E402

# A Windows console is cp1252 and the dashes below are not in it, so an
# unwidened stdout turns this script's own output into mojibake. Same fix as
# bridge.py, same reason.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# The main-stream/sub-stream pair each vendor ships by default. Sub-streams come
# first: they open faster, and if one works the main stream differs only in the
# channel digit.
PATHS = [
    ("Hikvision",     "/Streaming/Channels/102"),
    ("Hikvision",     "/Streaming/Channels/101"),
    ("Dahua",         "/cam/realmonitor?channel=1&subtype=1"),
    ("Dahua",         "/cam/realmonitor?channel=1&subtype=0"),
    ("CP Plus",       "/cam/realmonitor?channel=1&subtype=1"),
    ("TP-Link/Tapo",  "/stream2"),
    ("TP-Link/Tapo",  "/stream1"),
    ("Reolink",       "/h264Preview_01_sub"),
    ("Reolink",       "/h264Preview_01_main"),
    ("Amcrest",       "/cam/realmonitor?channel=1&subtype=1"),
    ("ONVIF generic", "/onvif1"),
    ("ONVIF generic", "/live"),
    ("Generic",       "/11"),
    ("Generic",       "/"),
]


def redact(url):
    at, scheme = url.rfind("@"), url.find("://")
    return url if at == -1 or scheme == -1 or at < scheme else f"{url[:scheme + 3]}***@{url[at + 1:]}"


def reachable(host, port, timeout=3.0):
    try:
        with socket.create_connection((host, port), timeout):
            return True
    except OSError:
        return False


def probe(url):
    """True if the URL opens AND hands over a real frame."""
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    try:
        if not cap.isOpened():
            return None
        for _ in range(30):  # first frames after a connect are often empty
            ok, frame = cap.read()
            if ok and frame is not None and frame.size:
                return frame.shape[1], frame.shape[0]
        return None
    finally:
        cap.release()


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2

    if args[0].lower().startswith("rtsp://"):
        candidates = [("as given", args[0])]
        host = args[0].split("@")[-1].split("/")[0].split(":")[0]
    else:
        if len(args) < 3:
            print("Need: python probe_rtsp.py <ip> <username> <password>")
            return 2
        host, user, password = args[0], args[1], args[2]
        port = 554
        candidates = [
            (brand, f"rtsp://{user}:{password}@{host}:{port}{path}") for brand, path in PATHS
        ]

    print(f"Checking whether {host}:554 is open at all ...")
    if not reachable(host, 554):
        print(f"  NO — nothing is listening on {host}:554.")
        print("  The camera is off, on another IP, on a non-standard port, or behind a")
        print("  different subnet/VLAN than this PC. Fix that before anything else.")
        return 1
    print("  yes, the port is open\n")

    for label, url in candidates:
        print(f"  {label:<14} {redact(url)}", flush=True)
        size = probe(url)
        if size:
            print(f"\nWORKS — {size[0]}x{size[1]}\n  {redact(url)}")
            print("\nPaste that URL (with the real password) into the camera form in the UI.")
            return 0

    print("\nNone of the common paths answered.")
    print("The port is open, so this is credentials or a vendor-specific path.")
    print("Check the camera's own web page for its RTSP URL, or try VLC:")
    print("  Media > Open Network Stream > paste the URL")
    return 1


if __name__ == "__main__":
    sys.exit(main())
