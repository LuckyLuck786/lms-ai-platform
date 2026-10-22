"""Speech-to-text for uploaded lecture video (PRD §9.3).

Chunking and embedding only ever run against a transcript, so an instructor who
uploads a video without pasting text leaves that lecture invisible to the AI
tutor. This route closes that gap: download the stored media, hand it to Groq's
Whisper endpoint, persist the transcript on the lecture row, then run the
existing RAG ingestion so citations become available in the same call.

Constraints that shape the design:

* **Size.** The STT provider caps uploads (~25 MB). Most raw video exceeds it,
  but an extracted audio track at 48 kbps mono does not — so oversized media is
  reduced with ffmpeg rather than refused. If ffmpeg is missing the reason is
  reported plainly instead of surfacing as an opaque provider error.
* **Reachability.** The media path is stored backend-relative
  (`/uploads/...`), which this service cannot resolve from its own origin, so
  the backend sends an absolute URL. A non-absolute URL is skipped with a hint
  rather than failing mid-download.
* **Idempotence.** A lecture that already has a transcript is skipped, so a
  retry after a crash cannot clobber a manual transcript or re-bill the
  provider.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..core.config import get_settings
from ..core.db import execute, query_one
from ..rag.ingest import ingest_lecture

router = APIRouter()

# Groq's audio-transcription endpoint. OpenAI-compatible, so the same shape
# works against any compatible provider by changing the base URL + key.
STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

# Refuse a download outright well beyond the upload limit; the lecture upload
# itself is capped at 512 MB, so this keeps a runaway response bounded.
DOWNLOAD_HARD_LIMIT = 512 * 1024 * 1024

CONTENT_TYPES = {
    ".mp4": "video/mp4",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".mpg": "audio/mpeg",
    ".mpeg": "audio/mpeg",
    ".flac": "audio/flac",
}


class TranscribeRequest(BaseModel):
    lecture_id: str
    #: Absolute URL the backend resolved from the stored `/uploads/...` path.
    #: `Optional[...]` rather than `X | None`: pydantic evaluates these field
    #: annotations at runtime, which the `|` union syntax only supports on
    #: Python 3.10+ (and this service must still import on 3.9).
    media_url: Optional[str] = None


def plan_transcription(
    *,
    transcript: Optional[str],
    media_url: Optional[str],
    has_key: bool,
) -> "tuple[bool, str]":
    """Decide whether a lecture is worth calling the provider for.

    Pure so the skip conditions are unit-testable without a database, a
    network, or a provider key. Returns `(proceed, reason)`; `reason` is only
    meaningful when `proceed` is False.
    """
    if transcript and transcript.strip():
        return False, "lecture already has a transcript"
    if not media_url:
        return False, "lecture has no video"
    if not media_url.lower().startswith(("http://", "https://")):
        return False, (
            "media URL is not absolute — set PUBLIC_API_URL on the backend so "
            "the AI service can fetch the file"
        )
    if not has_key:
        return False, "no GROQ_API_KEY configured"
    return True, ""


def plan_payload(
    *,
    size_bytes: int,
    max_bytes: int,
    ffmpeg_available: bool,
) -> "tuple[str, str]":
    """Choose how to hand a downloaded file to the STT provider.

    Returns `("as_is", ...)`, `("extract_audio", ...)` or
    `("reject", ...)` with a reason an operator can act on.
    """
    if size_bytes <= max_bytes:
        return "as_is", "fits the provider upload limit"
    if ffmpeg_available:
        return "extract_audio", "oversized, so reduce it to an audio track first"
    return (
        "reject",
        f"file is {size_bytes} bytes, over the {max_bytes} byte provider limit, "
        "and ffmpeg is not installed to extract a smaller audio track",
    )


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def download_to_temp(url: str, hard_limit: int, dest_dir: Path) -> Path:
    """Stream the media to a temporary file, refusing anything over `hard_limit`."""
    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        with client.stream("GET", url) as response:
            response.raise_for_status()
            declared = response.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > hard_limit:
                raise HTTPException(
                    status_code=413,
                    detail=f"Media is {declared} bytes, over the {hard_limit} byte download limit",
                )
            suffix = Path(url.split("?")[0]).suffix or ".bin"
            target = dest_dir / f"media{suffix}"
            written = 0
            with target.open("wb") as handle:
                for chunk in response.iter_bytes():
                    written += len(chunk)
                    if written > hard_limit:
                        raise HTTPException(
                            status_code=413,
                            detail=f"Media exceeded the {hard_limit} byte download limit",
                        )
                    handle.write(chunk)
    return target


def extract_audio(source: Path, dest_dir: Path) -> Path:
    """Reduce a video file to a small mono audio track with ffmpeg."""
    if not ffmpeg_available():
        raise HTTPException(
            status_code=501,
            detail="ffmpeg is required to extract audio from an oversized video file",
        )
    target = dest_dir / "audio.mp3"
    # -vn drops the video stream; mono/16 kHz/48 kbps keeps even a long lecture
    # comfortably inside the provider's limit while staying fully intelligible.
    proc = subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(source),
            "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k",
            str(target),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0 or not target.exists():
        raise HTTPException(
            status_code=500,
            detail=f"ffmpeg failed to extract audio: {proc.stderr[-500:]}",
        )
    return target


def upload_for_transcription(path: Path, model: str) -> str:
    """Send the media to the STT provider and return the text."""
    settings = get_settings()
    content_type = CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
    with path.open("rb") as handle:
        response = httpx.post(
            STT_URL,
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            files={"file": (path.name, handle, content_type)},
            data={"model": model, "response_format": "json", "temperature": "0"},
            timeout=300.0,
        )
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"STT provider returned {response.status_code}: {response.text[:500]}",
        )
    payload = response.json()
    text = payload.get("text")
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(status_code=502, detail="STT provider returned no transcript text")
    return text


@router.post("/transcribe")
def transcribe(req: TranscribeRequest) -> dict:
    """POST /api/v1/ai/internal/transcribe — video → transcript → RAG index."""
    settings = get_settings()

    lecture = query_one(
        "SELECT id, transcript, video_url FROM lectures WHERE id = %s",
        [req.lecture_id],
    )
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")

    media_url = req.media_url or lecture.get("video_url")
    proceed, reason = plan_transcription(
        transcript=lecture.get("transcript"),
        media_url=media_url,
        has_key=bool(settings.groq_api_key),
    )
    if not proceed:
        return {"status": "skipped", "reason": reason, "lecture_id": req.lecture_id}

    max_bytes = settings.stt_max_bytes
    with tempfile.TemporaryDirectory(prefix="lms-stt-") as tmp:
        dest_dir = Path(tmp)
        source = download_to_temp(media_url, DOWNLOAD_HARD_LIMIT, dest_dir)

        action, why = plan_payload(
            size_bytes=source.stat().st_size,
            max_bytes=max_bytes,
            ffmpeg_available=ffmpeg_available(),
        )
        if action == "reject":
            return {"status": "skipped", "reason": why, "lecture_id": req.lecture_id}
        if action == "extract_audio":
            source = extract_audio(source, dest_dir)
            if source.stat().st_size > max_bytes:
                return {
                    "status": "skipped",
                    "reason": (
                        f"audio track is still {source.stat().st_size} bytes, over the "
                        f"{max_bytes} byte provider limit"
                    ),
                    "lecture_id": req.lecture_id,
                }

        transcript = upload_for_transcription(source, settings.stt_model)

    # Persist first: if ingestion then fails, the transcript survives and a
    # later ingest retry does not have to pay for speech-to-text again.
    execute("UPDATE lectures SET transcript = %s WHERE id = %s", [transcript, req.lecture_id])
    ingest = ingest_lecture(req.lecture_id)

    return {
        "status": "ok",
        "lecture_id": req.lecture_id,
        "characters": len(transcript),
        "ingest": ingest,
        "reduced_to_audio": action == "extract_audio",
    }
