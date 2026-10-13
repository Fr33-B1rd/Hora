"""Speech-to-text worker for the web server: one faster-whisper model kept loaded, requests on
standard input as JSON lines, answers on standard output. Audio stays in memory and nothing
about a request is kept after it is answered.

  python transcribe.py MODEL        e.g. base.en
"""
import base64
import io
import json
import os
import sys

import av
import numpy as np
from faster_whisper import WhisperModel

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
MAX_SECONDS = 30


def reply(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def decode(data):
    """16 kHz mono samples from a browser recording. Read with PyAV directly: faster-whisper's
    own reader passes an option that the newest PyAV no longer accepts."""
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    chunks = []
    with av.open(io.BytesIO(data)) as container:
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))
    if not chunks:
        raise ValueError("empty")
    return np.concatenate(chunks).astype(np.float32) / 32768.0


try:
    model = WhisperModel(sys.argv[1], device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 2)
except Exception:
    reply({"error": "The speech model could not be loaded on this server."})
    sys.exit(1)
reply({"ready": True})
for line in sys.stdin:
    request = audio = segments = text = None
    try:
        request = json.loads(line)
        audio = decode(base64.b64decode(request["audio"], validate=True))
        if len(audio) > MAX_SECONDS * 16000:
            raise OverflowError
        # Names the model should expect (stations, places, the user's own topics) make it far less
        # likely to mishear them; they come from the server, never from the page.
        segments, _info = model.transcribe(audio, language="en", beam_size=1, vad_filter=True,
                                           condition_on_previous_text=False, initial_prompt=request.get("hints") or None)
        text = " ".join(s.text.strip() for s in segments).strip()
        reply({"text": text[:1000], "seconds": round(len(audio) / 16000, 1)})
    except OverflowError:
        reply({"error": f"That recording is longer than {MAX_SECONDS} seconds. Say it more briefly."})
    except Exception:
        reply({"error": "That recording could not be read. Please try again."})
