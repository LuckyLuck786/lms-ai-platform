"""Document ingestion pipeline (PRD §9.3): transcript → chunks → pgvector."""

from ..core.db import execute, query_one
from .chunking import chunk_transcript
from .embeddings import embed


def ingest_lecture(lecture_id: str) -> dict:
    """Chunks a lecture transcript and writes embeddings into document_chunks.

    Re-ingestion replaces the lecture's existing chunks so edits to a
    transcript don't leave stale vectors behind.
    """
    lecture = query_one(
        """
        SELECT l.id, l.transcript, l.duration_seconds, m.course_id
        FROM lectures l
        JOIN modules m ON m.id = l.module_id
        WHERE l.id = %s
        """,
        [lecture_id],
    )
    if not lecture:
        return {"status": "skipped", "reason": "lecture not found"}

    transcript = lecture.get("transcript") or ""
    if not transcript.strip():
        return {"status": "skipped", "reason": "no transcript"}

    chunks = chunk_transcript(transcript)
    if not chunks:
        return {"status": "skipped", "reason": "empty transcript"}

    # Replace previous chunks for this lecture (idempotent re-ingestion)
    execute("DELETE FROM document_chunks WHERE lecture_id = %s", [lecture_id])

    created = 0
    for text in chunks:
        vector = embed(text)
        vector_literal = "[" + ",".join(f"{v:.6f}" for v in vector) + "]"
        execute(
            """
            INSERT INTO document_chunks (course_id, lecture_id, chunk_text, embedding)
            VALUES (%s, %s, %s, %s::vector)
            """,
            [lecture["course_id"], lecture_id, text, vector_literal],
        )
        created += 1

    return {"status": "ok", "chunks": created, "lecture_id": lecture_id}
