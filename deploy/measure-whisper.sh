#!/usr/bin/env bash
# Measure how fast this machine turns speech into text with faster-whisper, to decide
# whether voice input can run here and with which model. Changes nothing in Daylight:
# everything goes into ~/whisper-bench, which can be deleted afterwards.
#
#   bash deploy/measure-whisper.sh
#
# Downloads: the faster-whisper package (PyPI), three speech models (Hugging Face,
# about 0.8 GB together) and one 11-second public-domain speech clip. Takes a few minutes.
set -euo pipefail

bench="$HOME/whisper-bench"
mkdir -p "$bench"; cd "$bench"
echo "== Machine"
echo "cpu: $(nproc) cores, $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | xargs)"
free -m | awk '/Mem:/ {print "memory: " $2 " MB total, " $7 " MB available"}'

echo "== Setup"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-venv espeak-ng >/dev/null
[ -d venv ] || python3 -m venv venv
./venv/bin/pip install -q --upgrade pip
./venv/bin/pip install -q faster-whisper
echo "faster-whisper $(./venv/bin/pip show faster-whisper | awk '/^Version/ {print $2}')"

# A real voice (11 s, public domain) and two short synthetic requests of the kind Daylight gets.
[ -s real.flac ] || curl -fsSL -o real.flac https://github.com/SYSTRAN/faster-whisper/raw/master/tests/data/jfk.flac || echo "note: could not fetch the real speech clip; only synthetic clips will be timed"
espeak-ng -v en-gb -s 150 -w short.wav "Any jobs for me today?"
espeak-ng -v en-gb -s 150 -w names.wav "Plan tomorrow from Slussen. A museum, and then sushi near Medborgarplatsen."

cat > bench.py <<'PY'
import os, resource, sys, time, wave
from faster_whisper import WhisperModel

clips = [c for c in ("short.wav", "names.wav", "real.flac") if os.path.exists(c) and os.path.getsize(c) > 0]
hints = "Slussen, Medborgarplatsen, Fridhemsplan, T-Centralen, Södermalm, Daylight"

def decode(path):
    """The clip as 16 kHz mono samples. Done here with PyAV directly: faster-whisper's own
    file reader passes an option that the newest PyAV no longer accepts."""
    import av, numpy as np
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    chunks = []
    with av.open(path) as container:
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))
    return np.concatenate(chunks).astype(np.float32) / 32768.0

audio = {clip: decode(clip) for clip in clips}

def seconds(path):
    return len(audio[path]) / 16000

print(f"{'model':<10} {'load s':>7} {'clip':<11} {'audio s':>8} {'time s':>7}  heard")
for name in ("base.en", "small.en", "small"):
    start = time.time()
    model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 2)
    load = time.time() - start
    for clip in clips:
        best, text = None, ""
        for _ in range(2):  # the first run of a model is slower; the second is what a user would feel
            start = time.time()
            segments, _info = model.transcribe(audio[clip], beam_size=1, language="en", initial_prompt=hints, vad_filter=False)
            text = " ".join(s.text.strip() for s in segments)
            took = time.time() - start
            best = took if best is None else min(best, took)
        print(f"{name:<10} {load:>7.1f} {clip:<11} {seconds(clip):>8.1f} {best:>7.1f}  {text[:90]}")
    print(f"{'':<10} memory in use after this model: {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024} MB")
    del model
PY
echo "== Timings (lower 'time s' is better; under about 1.5 s for the short clips feels immediate)"
./venv/bin/python bench.py
echo
echo "Done. Paste everything from '== Machine' down. To remove the test files: rm -rf ~/whisper-bench"
