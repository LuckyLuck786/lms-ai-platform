"""Embedding generation — produces VECTOR(1536) rows for document_chunks.

Provider order: Gemini (``gemini-embedding-001``, free tier) → deterministic
local fallback so development works with no keys at all.

``gemini-embedding-001`` natively emits 3072 dimensions, but it is
Matryoshka-trained: we request a 1536-dimension prefix via
``outputDimensionality`` so the vectors land exactly on the
``document_chunks.embedding VECTOR(1536)`` column — no truncation, no padding
for the happy path.
"""

import hashlib

import httpx

from ..core.config import get_settings

GEMINI_EMBED_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
# Historical name kept for callers/tests that referenced the old constant.
GEMINI_EMBED_URL = f"{GEMINI_EMBED_BASE}/gemini-embedding-001:embedContent"
# Dimensions requested from the Gemini embedding model.
GEMINI_EMBED_DIMS = 1536
TARGET_DIMS = 1536


def pad_to(vector: list[float], dims: int = TARGET_DIMS) -> list[float]:
    """Zero-pad/truncate an embedding to the column dimension.

    Cosine similarity is invariant under zero-padding of both vectors
    (dot product and norms are unchanged), so pgvector's <=> operator
    behaves identically. This matters when a provider returns fewer dims
    than the column, e.g. text-embedding-004's 768.
    """
    if len(vector) >= dims:
        return vector[:dims]
    return vector + [0.0] * (dims - len(vector))


def _supports_output_dimensionality(model: str) -> bool:
    """Only the gemini-embedding-* family accepts outputDimensionality."""
    return model.startswith("gemini-embedding")


def _embed_gemini(text: str) -> list[float]:
    settings = get_settings()
    model = settings.embedding_model or "gemini-embedding-001"
    payload: dict = {
        "model": f"models/{model}",
        "content": {"parts": [{"text": text[:8000]}]},
    }
    if _supports_output_dimensionality(model):
        payload["outputDimensionality"] = TARGET_DIMS

    resp = httpx.post(
        f"{GEMINI_EMBED_BASE}/{model}:embedContent",
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
