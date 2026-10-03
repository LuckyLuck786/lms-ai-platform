"""Similarity retrieval over document_chunks filtered by course_id (PRD §9.2)."""

import psycopg
from psycopg.rows import dict_row

from ..core.config import get_settings
from .embeddings import embed

TOP_K = 6


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
