"""Plate formats for the video test bench.

The live reader (anpr.py) only accepts Indian plates, which is right at the
gate and wrong for test footage from anywhere else. Each region here answers
two questions about a raw OCR string: what is the most likely plate it was
meant to be, and could that plate actually have been issued.

Indian rules are borrowed from anpr.py rather than copied, so the test bench
and the gate can never disagree about what a valid Indian plate is.
"""

import datetime
import os
import re
import sys

# anpr.py sits one folder up. Importing it only pulls in cv2 and numpy — the
# OCR model is loaded by anpr.Reader, which is never constructed here.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import anpr  # noqa: E402

ALLOWLIST = anpr.ALLOWLIST
TO_DIGIT = anpr.TO_DIGIT
TO_ALPHA = anpr.TO_ALPHA

REGIONS = ("auto", "uk", "in", "any")

# Current UK format (Sept 2001 on), the only format seen in the test footage:
#
#     A B  1 2  C D E
#     | |  |_|  |___|
#     | |   |     random letters: any letter except I and Q
#     | |   age identifier: March plates "02".."yy", September plates "51".."50+yy"
#     | local memory tag: any letter except I, Q, Z
#     region letter: only the letters DVLA issues (no I, J, Q, T, U, Z)
#
# Checking the letters and the age against what DVLA actually issues is what
# rejects confident nonsense: "AB50CDE", "QX12ABC" or "TN09BXA" are the right
# *shape*, but no such plate can exist.
UK_RE = re.compile(r"^[A-Z]{2}[0-9]{2}[A-Z]{3}$")
UK_REGION_LETTERS = set("ABCDEFGHKLMNOPRSVWXY")
UK_MEMORY_LETTERS = set("ABCDEFGHJKLMNOPRSTUVWXY")
UK_RANDOM_LETTERS = set("ABCDEFGHJKLMNOPRSTUVWXYZ")
# Indian plates (anpr.py): LL DD L{1,3} DDDD with a real state/UT code, or
# Bharat series YY BH DDDD L{1,2}. On top of anpr.py's checks, a district of
# "00" and a number of "0000" are never issued.
# Auto accepts either format; they cannot be confused, since a UK plate is 7
# characters and an Indian one 9 or 10.
# Anything plate-like: 4-10 characters, at least one letter and one digit.
ANY_RE = re.compile(r"^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{4,10}$")


def uk_age_valid(age, today=None):
    """Whether a two-digit UK age identifier has been issued yet."""
    today = today or datetime.date.today()
    yy = today.year % 100
    latest_march = yy if today.month >= 3 else yy - 1
    latest_sept = 50 + (yy if today.month >= 9 else yy - 1)
    n = int(age)
    return 2 <= n <= latest_march or 51 <= n <= latest_sept


def uk_valid(plate):
    return bool(
        UK_RE.match(plate)
        and plate[0] in UK_REGION_LETTERS
        and plate[1] in UK_MEMORY_LETTERS
        and uk_age_valid(plate[2:4])
        and all(c in UK_RANDOM_LETTERS for c in plate[4:])
    )


def clean(text):
    return anpr.clean(text or "")


# UK plates use the Charles Wright typeface, where a few extra shapes collide
# at this resolution: 4 reads as A, 3 as J, 0 as U. Only applied where the
# format says a digit (or a letter) must be, so it can never touch a valid read.
UK_TO_DIGIT = str.maketrans({**{chr(k): v for k, v in TO_DIGIT.items()}, "A": "4", "J": "3", "U": "0"})
UK_TO_ALPHA = str.maketrans({**{chr(k): v for k, v in TO_ALPHA.items()}, "7": "T", "3": "B"})


def _repair_uk(s):
    """Fix letter/digit swaps by position. Never invents or drops a character."""
    if len(s) != 7:
        return s
    return s[0:2].translate(UK_TO_ALPHA) + s[2:4].translate(UK_TO_DIGIT) + s[4:7].translate(UK_TO_ALPHA)


def in_valid(plate):
    if anpr.BH_RE.match(plate):
        return plate[4:8] != "0000"
    return anpr.plausible(plate) and plate[2:4] != "00" and plate[-4:] != "0000"


def repair(raw, region):
    """Most likely plate for a raw read, fixing O/0-style swaps by position."""
    s = clean(raw)
    if region == "uk" or (region == "auto" and len(s) == 7):
        return _repair_uk(s)
    if region in ("in", "auto"):
        return anpr.repair(s)
    return s


def plausible(plate, region):
    if region == "uk":
        return uk_valid(plate)
    if region == "in":
        return in_valid(plate)
    if region == "auto":
        return uk_valid(plate) or in_valid(plate)
    return bool(ANY_RE.match(plate))


def pretty(plate, region=None):
    """Spaced the way the plate is printed, for display only."""
    if uk_valid(plate):
        return f"{plate[:4]} {plate[4:]}"
    m = re.match(r"^([A-Z]{2})(\d{2})([A-Z]{1,3})(\d{4})$", plate)
    if m:
        return " ".join(m.groups())
    m = re.match(r"^(\d{2})(BH)(\d{4})([A-Z]{1,2})$", plate)
    if m:
        return " ".join(m.groups())
    return plate
