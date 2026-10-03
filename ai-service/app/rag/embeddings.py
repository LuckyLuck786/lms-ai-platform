"""Embedding generation — produces VECTOR(1536) rows for document_chunks.

Provider order: Gemini text-embedding-004 (free tier, 768 dims — zero-padded
to 1536; padding with zeros preserves cosine similarity exactly, so chunks
embedded before/after remain comparable) → deterministic local fallback so
development works with no keys at all.
"""

import hashlib

import httpx

from ..core.config import get_settings

GEMINI_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "text-embedding-004:embedContent"
)
GEMINI_EMBED_DIMS = 768
TARGET_DIMS = 1536


def pad_to(vector: list[float], dims: int = TARGET_DIMS) -> list[float]:
    """Zero-pad an embedding to the column dimension.

    Cosine similarity is invariant under zero-padding of both vectors
    (dot product and norms are unchanged), so pgvector's <=> operator
    behaves identically.
    """
    if len(vector) >= dims:
        return vector[:dims]
    return vector + [0.0] * (dims - len(vector))


def _embed_gemini(text: str) -> list[float]:
    settings = get_settings()
    payload = {
        "model": "models/text-embedding-004",
        "content": {"parts": [{"text": text[:8000]}]},
    }
    resp = httpx.post(
        GEMINI_EMBED_URL,
        json=payload,
        params={"key": settings.gemini_api_key},
        timeout=30,
    )
    resp.raise_for_status()
    values = resp.json()["embedding"]["values"]
    return pad_to([float(v) for v in values])


def _embed_fallback(text: str) -> list[float]:
    """Deterministic pseudo-embedding (SHA-seeded LCG, unit-normalized)."""
    seed = int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:8], "big")
    values = []
    state = seed
    for _ in range(TARGET_DIMS):
        state = (1103515245 * state + 12345) % (2**31)
        values.append((state / (2**31)) * 2 - 1)
    norm = sum(v * v for v in values) ** 0.5 or 1.0
    return [v / norm for v in values]


def embed(text: str) -> list[float]:
    """Return a 1536-dimension embedding for `text` (Gemini if keyed)."""
    settings = get_settings()
    if settings.gemini_api_key:
        try:
            return _embed_gemini(text)
        except httpx.HTTPError:
            # Transient provider failure — fall through to the local encoder
            # so ingestion never blocks on an embedding outage.
            pass
    return _embed_fallback(text)


def embedding_provider() -> str:
    """Which encoder is active — surfaced in health/debug output."""
    return "gemini" if get_settings().gemini_api_key else "local-fallback"
