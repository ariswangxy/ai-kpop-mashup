"""Local AI audio service for Mashup Studio.

Runs Demucs (https://github.com/facebookresearch/demucs, MIT) for stem separation and madmom
(https://github.com/CPJKU/madmom, BSD) for beat and downbeat tracking, behind a tiny HTTP API:

    GET  /health                       -> {"ok": true, "model": ..., "device": ...}
    POST /separate?keep=vocals         body: WAV  -> WAV of the isolated vocals
    POST /separate?keep=instrumental   body: WAV  -> WAV of everything except vocals
    POST /beats                        body: WAV  -> {"beats": [s], "downbeats": [s]}

Models load once at startup. Requests are handled one at a time.
"""

import io
import json
import os
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
import soxr
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model

HOST = os.environ.get("SEPARATOR_HOST", "127.0.0.1")
PORT = int(os.environ.get("SEPARATOR_PORT", "8765"))
MODEL_NAME = os.environ.get("SEPARATOR_MODEL", "htdemucs_ft")
MAX_BODY_BYTES = 64 * 1024 * 1024


def pick_device() -> str:
    if os.environ.get("SEPARATOR_DEVICE"):
        return os.environ["SEPARATOR_DEVICE"]
    # Apple GPUs (mps) can't run Demucs: its 1-D convolutions exceed an MPS channel limit
    # (checked with torch 2.5-2.8), so Macs use the CPU.
    return "cuda" if torch.cuda.is_available() else "cpu"


def vocals_model(model):
    """htdemucs_ft is four specialists, one per stem. We only need vocals (the instrumental is
    mix − vocals), so run just the vocals specialist: same quality, about 4x faster."""
    vocals = model.sources.index("vocals")
    weights = getattr(model, "weights", None)
    if weights is not None:
        specialists = [m for m, w in zip(model.models, weights) if w[vocals] > 0]
        if len(specialists) == 1:
            return specialists[0]
    return model


DEVICE = pick_device()
print(f"Loading {MODEL_NAME} on {DEVICE}…", flush=True)
MODEL = vocals_model(get_model(MODEL_NAME))
MODEL.eval()
VOCALS = MODEL.sources.index("vocals")
LOCK = threading.Lock()

print("Loading madmom beat tracker…", flush=True)
from madmom.features.downbeats import DBNDownBeatTrackingProcessor, RNNDownBeatProcessor  # noqa: E402

BEAT_RNN = RNNDownBeatProcessor()
BEAT_DBN = DBNDownBeatTrackingProcessor(beats_per_bar=[4], fps=100)
print(f"Ready on http://{HOST}:{PORT}", flush=True)


def read_wav(data: bytes) -> tuple[np.ndarray, int]:
    """16-bit PCM WAV -> float32 array shaped (channels, samples)."""
    with wave.open(io.BytesIO(data)) as w:
        if w.getsampwidth() != 2:
            raise ValueError("Only 16-bit PCM WAV is supported.")
        channels, rate = w.getnchannels(), w.getframerate()
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    audio = pcm.reshape(-1, channels).T.astype(np.float32) / 32768.0
    return audio, rate


def write_wav(audio: np.ndarray, rate: int) -> bytes:
    pcm = (np.clip(audio, -1.0, 1.0).T * 32767.0).astype("<i2")
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(audio.shape[0])
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return out.getvalue()


def to_model_input(audio: np.ndarray, rate: int) -> torch.Tensor:
    """Match the model's channel count and sample rate."""
    wav = torch.from_numpy(audio)
    if wav.shape[0] == 1:
        wav = wav.repeat(MODEL.audio_channels, 1)
    wav = wav[: MODEL.audio_channels]
    if rate != MODEL.samplerate:
        import julius  # installed with demucs

        wav = julius.resample_frac(wav, rate, MODEL.samplerate)
    return wav


def separate(audio: np.ndarray, rate: int, keep: str) -> tuple[np.ndarray, int]:
    wav = to_model_input(audio, rate)
    # Normalise like the Demucs CLI does, then undo it on the output.
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with LOCK, torch.no_grad():
        sources = apply_model(MODEL, ((wav - mean) / std)[None], device=DEVICE, shifts=1, split=True, overlap=0.25)[0]
    sources = sources * std + mean
    vocals = sources[VOCALS]
    # Subtract from the actual input (not the sum of model outputs) so nothing else is lost.
    stem = vocals if keep == "vocals" else wav - vocals
    return stem.cpu().numpy(), MODEL.samplerate


def find_beats(audio: np.ndarray, rate: int) -> dict:
    """Beat and downbeat (beat 1 of each 4/4 bar) times in seconds."""
    mono = audio.mean(0)
    if rate != 44100:  # madmom's models expect 44.1 kHz
        mono = soxr.resample(mono, rate, 44100)
    with LOCK:
        result = BEAT_DBN(BEAT_RNN(mono.astype(np.float32)))
    # Only positions: madmom's beats wobble by tens of ms, so a tempo fitted to them drifts.
    # The app keeps its own drift-checked BPM for tempo matching.
    return {"beats": result[:, 0].tolist(), "downbeats": result[result[:, 1] == 1, 0].tolist()}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, content_type: str):
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the app cancelled and hung up; nothing to deliver

    def _json(self, status: int, payload: dict):
        self._send(status, json.dumps(payload).encode(), "application/json")

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            self._json(200, {"ok": True, "model": MODEL_NAME, "device": DEVICE})
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path == "/beats":
            return self._beats()
        if url.path != "/separate":
            return self._json(404, {"error": "Not found"})
        keep = parse_qs(url.query).get("keep", ["vocals"])[0]
        if keep not in ("vocals", "instrumental"):
            return self._json(400, {"error": "keep must be 'vocals' or 'instrumental'"})
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= MAX_BODY_BYTES:
            return self._json(413, {"error": "Send a WAV body up to 64 MB."})
        try:
            audio, rate = read_wav(self.rfile.read(length))
            started = time.time()
            stem, out_rate = separate(audio, rate, keep)
            print(f"{keep}: {audio.shape[1] / rate:.1f}s of audio in {time.time() - started:.1f}s", flush=True)
            self._send(200, write_wav(stem, out_rate), "audio/wav")
        except Exception as e:  # report the failure to the app instead of dropping the connection
            print(f"separation failed: {e}", file=sys.stderr, flush=True)
            self._json(500, {"error": str(e)})

    def _beats(self):
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= MAX_BODY_BYTES:
            return self._json(413, {"error": "Send a WAV body up to 64 MB."})
        try:
            audio, rate = read_wav(self.rfile.read(length))
            started = time.time()
            result = find_beats(audio, rate)
            print(f"beats: {audio.shape[1] / rate:.1f}s of audio in {time.time() - started:.1f}s", flush=True)
            self._json(200, result)
        except Exception as e:
            print(f"beat tracking failed: {e}", file=sys.stderr, flush=True)
            self._json(500, {"error": str(e)})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
