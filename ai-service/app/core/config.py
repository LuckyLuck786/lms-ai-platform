from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings


def _find_env_file() -> Optional[Path]:
    """Walk up from the working directory to find the monorepo `.env`.

    `uvicorn app.main:app` runs with cwd=ai-service/, but the single source
    of truth for keys is the repo-root `.env`. Docker Compose and cloud hosts
    inject real env vars instead, so a missing file is not an error.
    """
    for directory in (Path.cwd(), *Path.cwd().parents):
        candidate = directory / ".env"
        if candidate.is_file():
            return candidate
    return None


class Settings(BaseSettings):
    """Environment-backed configuration for the AI Tutor service."""

    ai_service_port: int = 8000
    database_url: str = "postgresql://lms:lms_dev_password@localhost:5432/lms"
    redis_url: str = "redis://localhost:6379"

    # LLM providers — auto-detected in priority order: Groq → Gemini → Anthropic.
    # Model defaults are the ones the configured keys can actually serve:
    # Groq no longer offers llama-3.3-70b-versatile on this account, and
    # Gemini has retired gemini-2.0-flash.
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    # Gemini 2.5+/3.x spends output budget on hidden thinking. 0 keeps the
    # whole budget for the student-visible answer (latency is a stated KPI).
    gemini_thinking_budget: int = 0
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-5"

    @property
    def llm_available(self) -> bool:
        """True when at least one LLM provider key is configured."""
        return bool(self.groq_api_key or self.gemini_api_key or self.anthropic_api_key)

    # Embeddings — 1536 dims to match document_chunks.embedding VECTOR(1536).
    # Gemini is used when GEMINI_API_KEY is set; text-embedding-004 is retired.
    embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = 1536

    # Speech-to-text (PRD §9.3). Groq's Whisper endpoint is OpenAI-compatible,
    # so changing provider means changing the URL, key and model only.
    stt_model: str = "whisper-large-v3-turbo"
    # Provider upload cap. Raw video routinely exceeds it, which is why the
    # transcribe route extracts an audio track with ffmpeg first.
    stt_max_bytes: int = 25 * 1024 * 1024

    # Shared JWT secrets with the backend (service-to-service verification)
    jwt_secret: str = "dev-only-change-me-jwt-secret-32-chars-min"

    # Shared secret the backend presents as `X-Internal-Token` on every call.
    # When set, every /api/v1/ai route demands it — this service is internal
    # and has no other caller, so an unauthenticated ingest or chat request
    # would otherwise let anyone poison the RAG corpus or spend the LLM budget.
    # Empty means "not enforced", which is the local-development default.
    internal_api_token: str = ""

    cors_origin: str = "http://localhost:5173"

    class Config:
        env_file = _find_env_file()
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
