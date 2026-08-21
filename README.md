# Number Plate Reader

A Streamlit app that reads vehicle number plates from a photo using the Gemini API.
Upload a car image, and it returns the plate number, a description of the vehicle,
a confidence level, and any characters it found ambiguous.

## Requirements

- Python 3.10 or newer
- A Gemini API key (already hardcoded in `app.py` — see [API key](#api-key))

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

Using a virtual environment is optional — `pip install -r requirements.txt` on its own
works too.

## Run

```powershell
streamlit run app.py
```

Streamlit opens `http://localhost:8501` in your browser. Upload a JPG, PNG, or WEBP
of a car, then click **Read plate**.

To stop the app, press `Ctrl+C` in the terminal.

## How it works

`app.py` sends the uploaded image to Gemini with a prompt that asks it to transcribe
plates exactly, and with a JSON schema describing the expected output. Temperature is
set to `0`, and the prompt explicitly tells the model not to guess a plausible plate
or "correct" an unusual one — if it cannot read a plate, it returns an empty result
and explains why in the notes.

Images larger than 15 MB are downscaled automatically, since the API caps a request
containing inline image data at 20 MB.

## Model and free tier

The app uses `gemini-3.5-flash-lite`, which is free and reads plates accurately.

The Gemini free tier is limited to roughly **20 requests per day per model**, and each
model has its own separate quota. If you run out, either wait for the quota to reset or
switch `MODEL` at the top of `app.py`:

| Model | Notes |
| --- | --- |
| `gemini-3.5-flash-lite` | Current default. Fast, free. |
| `gemini-3.1-flash-lite` | Separate quota, so useful as a fallback. |
| `gemini-3.5-flash` | Stronger, but the same small free daily quota. |
| `gemini-3.7-flash` | Smartest, but frequently returns `503 high demand` on the free tier. |

## API key

The key is hardcoded at the top of `app.py`, as intended for local use.

Note that this means **anyone who gets a copy of this file can spend your quota**.
If you push this project to a public repository, rotate the key at
[Google AI Studio](https://aistudio.google.com/apikey). To avoid that entirely, you can
read the key from an environment variable instead:

```python
import os
API_KEY = os.environ["GEMINI_API_KEY"]
```

```powershell
$env:GEMINI_API_KEY = "your-key-here"
```

## Troubleshooting

| Message | What it means |
| --- | --- |
| `Free-tier quota hit` / `429 RESOURCE_EXHAUSTED` | Daily or per-minute limit reached. Wait, or switch model. |
| `503 UNAVAILABLE ... high demand` | The model is busy. Retry, or switch to a lite model. |
| `Cannot send a request, as the client has been closed` | Only happens if the Gemini client isn't held in a variable. The app already handles this. |

## Files

| File | Purpose |
| --- | --- |
| `app.py` | Streamlit number plate reader |
| `requirements.txt` | Dependencies |
