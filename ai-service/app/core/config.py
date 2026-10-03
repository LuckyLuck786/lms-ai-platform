from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Environment-backed configuration for the AI Tutor service."""

    ai_service_port: int = 8000
    database_url: str = "postgresql://lms:lms_dev_password@localhost:5432/lms"
    redis_url: str = "redis://localhost:6379"

    # LLM providers — auto-detected in priority order: Groq → Gemini → Anthropic
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-5"

    @property
    def llm_available(self) -> bool:
        """True when at least one LLM provider key is configured."""
        return bool(self.groq_api_key or self.gemini_api_key or self.anthropic_api_key)

    # Embeddings — 1536 dims to match document_chunks.embedding VECTOR(1536)
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536

    # Shared JWT secrets with the backend (service-to-service verification)
    jwt_secret: str = "dev-only-change-me-jwt-secret-32-chars-min"

    cors_origin: str = "http://localhost:5173"

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
