"""Similarity retrieval over document_chunks filtered by course_id (PRD §9.2)."""

import psycopg
from psycopg.rows import dict_row

from ..core.config import get_settings
from .embeddings import embed, embedding_provider

TOP_K = 6

# Cosine similarity below which a chunk is not about the question. Measured on
# gemini-embedding-001 over a real course: on-topic questions score 0.66-0.72
# on the right lecture, while unrelated lectures and off-topic questions stay
# at or below ~0.51. Without the cut the tutor was handed the "closest"
# irrelevant chunks and cited lectures that never covered the topic.
MIN_SIMILARITY = 0.55


def relevant(chunks: list[dict]) -> list[dict]:
    """Keep only chunks that are actually about the question.

    Applied only with real embeddings: the offline hash fallback has no
    meaningful similarity scale, so there every chunk is kept.
    """
    if embedding_provider() != "gemini":
        return chunks
    return [c for c in chunks if (c.get("similarity") or 0) >= MIN_SIMILARITY]


def retrieve(course_id: str, question: str, top_k: int = TOP_K) -> list[dict]:
    """Return the top-k chunks for a question within a single course.

    Each hit carries citation metadata: lecture id/title and an approximate
    timestamp derived from the chunk's position in the lecture.
    """
    vector = embed(question)
    vector_literal = "[" + ",".join(f"{v:.6f}" for v in vector) + "]"

    with psycopg.connect(get_settings().database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, lecture_id, chunk_text, lecture_title, similarity, timestamp_seconds
                FROM (
                    SELECT dc.id,
                           dc.lecture_id,
                           dc.chunk_text,
                           l.title AS lecture_title,
                           1 - (dc.embedding <=> %s::vector) AS similarity,
                           COALESCE(l.duration_seconds, 0) AS duration,
                           FLOOR(
                               (ROW_NUMBER() OVER (PARTITION BY dc.lecture_id ORDER BY dc.id) - 1)
                               / GREATEST(COUNT(*) OVER (PARTITION BY dc.lecture_id), 1)
                               * COALESCE(l.duration_seconds, 0)
                           )::int AS timestamp_seconds
                    FROM document_chunks dc
                    LEFT JOIN lectures l ON l.id = dc.lecture_id
                    WHERE dc.course_id = %s
                ) ranked
                ORDER BY similarity DESC
                LIMIT %s
                """,
                [vector_literal, course_id, top_k],
            )
            return [dict(row) for row in cur.fetchall()]
