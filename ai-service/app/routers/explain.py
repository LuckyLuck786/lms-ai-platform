"""“Explain my mistake” — a grounded explanation of one wrong quiz answer.

The backend has already checked that the attempt belongs to the learner and
that the answer was wrong, and sends the question with every option marked
correct/chosen. This service retrieves the course material closest to the
question (the same RAG retriever the tutor uses) and asks the LLM why the
learner's choice is wrong and what the right reasoning is — citing lectures.
"""

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from ..core.config import get_settings
from ..core.llm import LLMError, complete
from ..rag.prompt import build_context_blocks
from ..rag.retriever import relevant, retrieve

router = APIRouter()


class Option(BaseModel):
    text: str
    is_correct: bool
    chosen: bool


class ExplainRequest(BaseModel):
    course_id: str
    course_title: str
    question_text: str
    question_type: str
    options: list[Option] = []
    text_answer: Optional[str] = None


SYSTEM = (
    "You are a patient tutor for the course “{course}”. A learner answered a quiz question "
    "incorrectly. Explain, in under 150 words:\n"
    "1. why their answer is wrong — address the specific misconception it suggests;\n"
    "2. the correct answer and the reasoning that leads to it.\n"
    "Ground the explanation ONLY in the CONTEXT excerpts and name the lecture you rely on. "
    "If the CONTEXT is empty or does not cover the question, say the course material does not "
    "cover it, explain from the question itself, and do not name any lecture. "
    "Be encouraging and direct; do not repeat the question back.\n\nCONTEXT:\n{context}"
)


def _describe(req: ExplainRequest) -> str:
    correct = [o.text for o in req.options if o.is_correct]
    if req.question_type == "short_answer":
        chosen = req.text_answer or "(no answer)"
    else:
        chosen = ", ".join(o.text for o in req.options if o.chosen) or "(nothing selected)"
    return (
        f"Question: {req.question_text}\n"
        f"Options: {', '.join(o.text for o in req.options) or 'free text'}\n"
        f"Learner's answer: {chosen}\n"
        f"Correct answer: {', '.join(correct) or 'see the lecture'}"
    )


def _fallback(req: ExplainRequest, chunks: list[dict]) -> str:
    correct = ", ".join(o.text for o in req.options if o.is_correct) or "the answer covered in the lecture"
    text = f"The correct answer is: {correct}."
    if chunks:
        title = chunks[0].get("lecture_title") or "the lecture"
        excerpt = chunks[0]["chunk_text"][:400].rsplit(" ", 1)[0]
        text += f" Review “{title}”: {excerpt}…"
    return text


@router.post("/explain")
def explain(req: ExplainRequest) -> dict:
    """POST /api/v1/ai/internal/explain — called by the backend only."""
    chunks = relevant(retrieve(req.course_id, req.question_text))
    demo_mode = False
    if get_settings().llm_available:
        try:
            reply = complete(
                SYSTEM.format(course=req.course_title, context="\n\n".join(build_context_blocks(chunks)) or "(none)"),
                [{"role": "user", "content": _describe(req)}],
                max_tokens=600,
            )
        except LLMError:
            reply, demo_mode = _fallback(req, chunks), True
    else:
        reply, demo_mode = _fallback(req, chunks), True

    sources, seen = [], set()
    for c in chunks:
        lid = c.get("lecture_id")
        if lid and lid not in seen:
            seen.add(lid)
            sources.append({"lecture_id": str(lid), "lecture_title": c.get("lecture_title")})
    return {"explanation": reply, "sources": sources, "demo_mode": demo_mode}
