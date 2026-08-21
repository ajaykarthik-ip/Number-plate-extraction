"""Streamlit app: upload a car photo, Gemini reads the number plate.

Setup: pip install -r requirements.txt
Run:   streamlit run app.py
"""

import io
import logging

import streamlit as st
from google import genai
from google.genai import types
from PIL import Image
from pydantic import BaseModel, Field

logging.getLogger("google_genai").setLevel(logging.ERROR)

# Hardcoded API key (as requested). Anyone with this file can spend your quota.
API_KEY = "replace-with-your-key"

# Free-tier vision model. gemini-3.5-flash is stronger but its free quota is only
# 20 requests/day, so the lite model is the better default here.
MODEL = "gemini-3.5-flash-lite"

MAX_BYTES = 15 * 1024 * 1024  # inline image data must stay well under the 20MB request cap


class Plate(BaseModel):
    plate_number: str = Field(description="Plate characters exactly as shown, spacing preserved")
    vehicle: str = Field(description="Short description of the vehicle, e.g. 'red hatchback'")
    confidence: str = Field(description="One of: high, medium, low")
    unclear_characters: str = Field(description="Characters that were ambiguous, or '' if none")


class Reading(BaseModel):
    plates: list[Plate]
    notes: str = Field(description="Anything worth flagging, e.g. blur or glare. '' if nothing.")


PROMPT = """Read every vehicle number plate visible in this photo.

Rules:
- Transcribe exactly what is printed, character for character. Do not guess a
  plausible plate, and do not "correct" an unusual one.
- Keep the original spacing and any state/region prefix.
- If a character is ambiguous (0 vs O, 1 vs I, 8 vs B), give your best reading and
  list that character in unclear_characters.
- If no plate is readable, return an empty plates list and say why in notes."""


@st.cache_resource
def get_client() -> genai.Client:
    return genai.Client(api_key=API_KEY)


def prepare(raw: bytes) -> tuple[bytes, str]:
    """Return image bytes small enough to send inline, plus their mime type."""
    if len(raw) <= MAX_BYTES:
        return raw, "image/jpeg" if raw[:2] == b"\xff\xd8" else "image/png"

    img = Image.open(io.BytesIO(raw))
    img.thumbnail((2400, 2400))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=90)
    return buf.getvalue(), "image/jpeg"


def read_plates(raw: bytes) -> Reading:
    data, mime = prepare(raw)
    # Bind the client to a local: in google-genai 2.x an unreferenced Client can be
    # closed by the GC mid-request ("Cannot send a request, as the client has been closed").
    client = get_client()
    response = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(data=data, mime_type=mime),
            types.Part(text=PROMPT),
        ],
        config=types.GenerateContentConfig(
            system_instruction="You are a careful ANPR system that reads vehicle number plates.",
            temperature=0,
            response_mime_type="application/json",
            response_schema=Reading,
        ),
    )
    return response.parsed


st.set_page_config(page_title="Number Plate Reader", page_icon="🚗")
st.title("🚗 Number Plate Reader")
st.caption(f"Upload a car photo and Gemini ({MODEL}) will read the plate.")

uploaded = st.file_uploader(
    "Car image", type=["jpg", "jpeg", "png", "webp"], label_visibility="collapsed"
)

if uploaded:
    raw = uploaded.getvalue()
    st.image(raw, caption=uploaded.name, width="stretch")

    if st.button("Read plate", type="primary"):
        try:
            with st.spinner("Reading..."):
                result = read_plates(raw)
        except Exception as e:
            message = str(e)
            if "RESOURCE_EXHAUSTED" in message or "429" in message:
                st.error("Free-tier quota hit. Wait a minute and try again.")
            else:
                st.error(f"Something went wrong: {message}")
        else:
            if not result or not result.plates:
                st.warning("No readable number plate found.")
                if result and result.notes:
                    st.caption(result.notes)
            else:
                for plate in result.plates:
                    st.subheader(plate.plate_number)
                    st.write(f"**Vehicle:** {plate.vehicle}")
                    st.write(f"**Confidence:** {plate.confidence}")
                    if plate.unclear_characters:
                        st.warning(f"Ambiguous characters: {plate.unclear_characters}")
                    st.divider()
                if result.notes:
                    st.caption(result.notes)
