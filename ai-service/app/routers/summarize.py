from fastapi import APIRouter, HTTPException

from ..core.config import get_settings
from ..core.db import query_one
from ..core.llm import LLMError, complete
from ..rag.chunking import chunk_transcript

router = APIRouter()

SYSTEM = (
    "You summarize lecture transcripts for students. Return 4-6 bullet points of key "
    "ideas plus one takeaway sentence. Use only the provided transcript."
)


@router.post("/lectures/{lecture_id}/summarize")
def summarize_lecture(lecture_id: str) -> dict:
    """POST /api/v1/ai/lectures/:id/summarize — FR-A3."""
    lecture = query_one(
        """
        SELECT l.id, l.title, l.transcript
        FROM lectures l JOIN modules m ON m.id = l.module_id
        WHERE l.id = %s
        """,
        [lecture_id],
    )
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    transcript = lecture.get("transcript") or ""
    if not transcript.strip():
        raise HTTPException(status_code=400, detail="Lecture has no transcript to summarize")

    if get_settings().llm_available:
        try:
            summary = complete(
                SYSTEM,
                [{"role": "user", "content": f"Transcript of “{lecture['title']}”:\n\n{transcript}"}],
                max_tokens=700,
            )
        except LLMError:
            summary = _fallback_summary(transcript)
    else:
        summary = _fallback_summary(transcript)

    return {"lecture_id": lecture_id, "title": lecture["title"], "summary": summary}


def _fallback_summary(transcript: str) -> str:
    """No LLM key: build bullets from the transcript's leading sentences."""
    chunks = chunk_transcript(transcript, max_chars=400, overlap=0)
    bullets = "\n".join(f"- {c.split('.')[0].strip()}." for c in chunks[:5] if c.strip())
    return f"(Demo summary — configure ANTHROPIC_API_KEY for Claude summaries.)\n{bullets}"
