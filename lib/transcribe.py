"""Private stdio worker. Audio remains in memory; model is loaded offline."""
import base64
import io
import json
import os
import sys

os.environ['HF_HUB_OFFLINE'] = '1'
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')

def reply(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

try:
    model = WhisperModel(sys.argv[1], device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
except Exception:
    reply({'error': 'Local speech model failed to load; please check local speech installation.'})
    sys.exit(1)
reply({'ready': True})
for line in sys.stdin:
    try:
        request = json.loads(line)
        audio = decode_audio(io.BytesIO(base64.b64decode(request['audio'], validate=True)), sampling_rate=16000)
        if len(audio) > 65 * 16000:
            raise ValueError('Recording exceeds 60 seconds, please shorten and retry.')
        segments, info = model.transcribe(audio, language=request['language'], beam_size=3, vad_filter=True,
                                         condition_on_previous_text=False)
        text = ''.join(s.text for s in segments).strip()
        reply({'text': text[:2000], 'language': info.language, 'duration': round(len(audio) / 16000, 2)})
    except ValueError as error:
        reply({'error': str(error) if str(error).startswith('Recording exceeds') else 'Audio format cannot be read; please re‑record.'})
    except Exception:
        reply({'error': 'Local transcription failed; please retry or use a shorter recording.'})
    finally:
        # Do not retain a user's audio/transcript across requests.
        line = request = audio = segments = text = None
