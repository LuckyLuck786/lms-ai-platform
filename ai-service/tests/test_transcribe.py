"""Video → transcript → RAG pipeline (PRD §9.3).

These tests stub the database, the download, the STT provider and ingestion, so
what is actually asserted is the *decision logic*: when to skip a lecture, when
to reduce oversized media, and whether the transcript is persisted before
ingestion runs. No test here needs Postgres, ffmpeg, or a provider key — CI has
none of the three.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import transcribe as t

client = TestClient(app, raise_server_exceptions=False)
TRANSCRIBE = "/api/v1/ai/internal/transcribe"


# ---------------------------------------------------------------------------
# decision logic
# ---------------------------------------------------------------------------


class TestPlanTranscription:
    def test_skips_a_lecture_that_already_has_a_transcript(self):
        proceed, reason = t.plan_transcription(
            transcript="Existing manual text.", media_url="https://x/v.mp4", has_key=True
        )
        assert proceed is False
        assert "already has" in reason

    def test_treats_whitespace_only_transcript_as_missing(self):
        proceed, reason = t.plan_transcription(
            transcript="   \n\t  ", media_url="https://x/v.mp4", has_key=True
        )
        # An instructor who saved an empty box should not lose their upload to
        # a false "already transcribed".
        assert proceed is True, reason

    def test_skips_a_lecture_with_no_video(self):
        proceed, reason = t.plan_transcription(
            transcript=None, media_url=None, has_key=True
        )
        assert proceed is False
        assert "no video" in reason

    def test_skips_a_relative_media_url_with_an_actionable_reason(self):
        # The backend must send an absolute URL (PUBLIC_API_URL); a relative
        # path would resolve against this service's own origin and 404.
        proceed, reason = t.plan_transcription(
            transcript=None, media_url="/uploads/lectures/abc.mp4", has_key=True
        )
        assert proceed is False
        assert "PUBLIC_API_URL" in reason

    def test_skips_when_no_provider_key_is_configured(self):
        proceed, reason = t.plan_transcription(
            transcript=None, media_url="https://x/v.mp4", has_key=False
        )
        assert proceed is False
        assert "GROQ_API_KEY" in reason

    def test_proceeds_when_everything_is_in_place(self):
        proceed, reason = t.plan_transcription(
            transcript=None, media_url="https://x/v.mp4", has_key=True
        )
        assert proceed is True, reason
        assert reason == ""

    @pytest.mark.parametrize("scheme", ["http://", "HTTPS://"])
    def test_accepts_either_http_scheme(self, scheme: str):
        url = f"{scheme}example.com/lecture.mp4"
        proceed, _ = t.plan_transcription(transcript=None, media_url=url, has_key=True)
        assert proceed is True


class TestPlanPayload:
    def test_small_file_goes_straight_to_the_provider(self):
        action, why = t.plan_payload(size_bytes=5_000_000, max_bytes=25_000_000, ffmpeg_available=False)
        assert action == "as_is"
        assert "limit" in why

    def test_oversized_file_is_reduced_when_ffmpeg_exists(self):
        action, why = t.plan_payload(size_bytes=400_000_000, max_bytes=25_000_000, ffmpeg_available=True)
        assert action == "extract_audio"
        assert "audio track" in why

    def test_oversized_file_is_rejected_with_a_fix_when_ffmpeg_is_missing(self):
        action, why = t.plan_payload(
            size_bytes=400_000_000, max_bytes=25_000_000, ffmpeg_available=False
        )
        assert action == "reject"
        # The operator needs to know it is ffmpeg that is missing, not the
        # provider, so the message names it explicitly.
        assert "ffmpeg" in why

    def test_boundary_size_is_accepted(self):
        action, _ = t.plan_payload(size_bytes=25, max_bytes=25, ffmpeg_available=True)
        assert action == "as_is"


def test_ffmpeg_available_is_boolean():
    assert isinstance(t.ffmpeg_available(), bool)


# ---------------------------------------------------------------------------
# route, with every side effect stubbed
# ---------------------------------------------------------------------------


class Harness:
    def __init__(self) -> None:
        # Untyped deliberately: `from __future__ import annotations` does not
        # cover every runtime evaluation path, and this suite must import on
        # Python 3.9 where the `|` union syntax is unavailable at runtime.
        self.lecture = None
        self.transcript_saved = None
        self.ingested_with = None
        self.download_calls = 0
        self.upload_calls = 0
        self.payload_plan = ("as_is", "fits")
        self.upload_text = "Spoken lecture transcript."


@pytest.fixture()
def harness(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Harness:
    h = Harness()

    monkeypatch.setattr(t, "query_one", lambda *_args, **_kw: h.lecture)

    def fake_download(url: str, hard_limit: int, dest_dir: Path) -> Path:
        h.download_calls += 1
        target = dest_dir / "media.mp4"
        target.write_bytes(b"\x00" * 64)
        return target

    def fake_upload(path: Path, model: str) -> str:
        h.upload_calls += 1
        return h.upload_text

    monkeypatch.setattr(t, "download_to_temp", fake_download)
    monkeypatch.setattr(t, "upload_for_transcription", fake_upload)

    # The reduction path shells out to ffmpeg; route tests must not depend on
    # ffmpeg or a valid media file. `test_extract_audio_...` below covers the
    # real binary separately, when it is installed.
    def fake_extract(source: Path, dest_dir: Path) -> Path:
        target = dest_dir / "audio.mp3"
        target.write_bytes(b"\x00" * 16)
        return target

    monkeypatch.setattr(t, "extract_audio", fake_extract)

    monkeypatch.setattr(
        t,
        "plan_payload",
        lambda **_kw: h.payload_plan,
    )

    monkeypatch.setattr(
        t,
        "execute",
        lambda sql, params: h.__setattr__("transcript_saved", params[0]),
    )
    monkeypatch.setattr(
        t,
        "ingest_lecture",
        lambda lecture_id: {"status": "ok", "chunks": 3},
    )

    class FakeSettings:
        groq_api_key = "gsk_test_key"
        stt_model = "whisper-large-v3-turbo"
        stt_max_bytes = 25 * 1024 * 1024

    monkeypatch.setattr(t, "get_settings", lambda: FakeSettings())
    return h


class TestRoute:
    def test_404s_for_an_unknown_lecture(self, harness: Harness):
        harness.lecture = None
        res = client.post(TRANSCRIBE, json={"lecture_id": "missing"})
        assert res.status_code == 404

    def test_persists_the_transcript_before_running_ingestion(
        self, harness: Harness
    ):
        order: list[str] = []
        harness.lecture = {"id": "l-1", "transcript": None, "video_url": None}
        harness.upload_text = "The transcript text."

        original_execute = harness.transcript_saved

        # Record the order by wrapping the stubs.
        t_execute = t.execute
        t_ingest = t.ingest_lecture

        def order_execute(sql, params):
            order.append("save")
            return t_execute(sql, params)

        def order_ingest(lecture_id):
            order.append("ingest")
            return t_ingest(lecture_id)

        import app.routers.transcribe as mod

        mod.execute = order_execute
        mod.ingest_lecture = order_ingest
        try:
            res = client.post(
                TRANSCRIBE,
                json={"lecture_id": "l-1", "media_url": "https://x/v.mp4"},
            )
        finally:
            mod.execute = t_execute
            mod.ingest_lecture = t_ingest

        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "ok"
        assert body["characters"] == len("The transcript text.")
        assert body["ingest"]["chunks"] == 3
        # Transcript first: if ingestion then fails, a retry must not pay for
        # speech-to-text again.
        assert order == ["save", "ingest"], order
        assert harness.transcript_saved == "The transcript text."
        assert original_execute is None

    def test_skips_without_downloading_when_already_transcribed(self, harness: Harness):
        harness.lecture = {"id": "l-1", "transcript": "Already done.", "video_url": "https://x/v.mp4"}
        res = client.post(
            TRANSCRIBE, json={"lecture_id": "l-1", "media_url": "https://x/v.mp4"}
        )
        assert res.status_code == 200
        assert res.json()["status"] == "skipped"
        assert "already has" in res.json()["reason"]
        # Nothing should have been fetched or billed for.
        assert harness.download_calls == 0
        assert harness.upload_calls == 0

    def test_skips_when_the_key_is_absent(self, harness: Harness, monkeypatch):
        class NoKey:
            groq_api_key = ""
            stt_model = "m"
            stt_max_bytes = 25 * 1024 * 1024

        monkeypatch.setattr(t, "get_settings", lambda: NoKey())
        harness.lecture = {"id": "l-1", "transcript": None, "video_url": "https://x/v.mp4"}
        res = client.post(
            TRANSCRIBE, json={"lecture_id": "l-1", "media_url": "https://x/v.mp4"}
        )
        assert res.status_code == 200
        assert res.json()["status"] == "skipped"
        assert harness.upload_calls == 0

    def test_reports_oversized_media_it_cannot_reduce(
        self, harness: Harness
    ):
        harness.payload_plan = (
            "reject",
            "file is 400000000 bytes, over the 25000000 byte provider limit, "
            "and ffmpeg is not installed to extract a smaller audio track",
        )
        harness.lecture = {"id": "l-1", "transcript": None, "video_url": "https://x/v.mp4"}
        res = client.post(
            TRANSCRIBE, json={"lecture_id": "l-1", "media_url": "https://x/v.mp4"}
        )
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "skipped"
        assert "ffmpeg" in body["reason"]
        assert harness.upload_calls == 0
        assert harness.transcript_saved is None

    def test_reports_the_reduction_it_performed(self, harness: Harness):
        harness.payload_plan = ("extract_audio", "oversized")
        harness.lecture = {"id": "l-1", "transcript": None, "video_url": "https://x/v.mp4"}
        res = client.post(
            TRANSCRIBE, json={"lecture_id": "l-1", "media_url": "https://x/v.mp4"}
        )
        assert res.status_code == 200, res.text
        assert res.json()["reduced_to_audio"] is True
        assert res.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# ffmpeg — real binary, when it exists (the Docker image installs it)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not t.ffmpeg_available(), reason="ffmpeg is not installed")
class TestExtractAudio:
    def test_extracts_a_playable_mono_track(self, tmp_path: Path):
        import subprocess

        # Synthesise a 2 s sine wave as a stand-in for a lecture recording.
        source = tmp_path / "clip.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", str(source)],
            check=True,
            capture_output=True,
        )
        assert source.exists()

        out = t.extract_audio(source, tmp_path)
        assert out.exists()
        assert out.suffix == ".mp3"
        assert out.stat().st_size > 0

    def test_refuses_without_ffmpeg(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        # Only meaningful where ffmpeg is genuinely absent — otherwise the
        # skip in extract_audio() would not trigger.
        if t.ffmpeg_available():
            pytest.skip("ffmpeg is installed on this machine")
        source = tmp_path / "clip.mp4"
        source.write_bytes(b"not a video")
        with pytest.raises(Exception) as exc:
            t.extract_audio(source, tmp_path)
        assert "ffmpeg" in str(exc.value)
