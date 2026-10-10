from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..core.config import get_settings
from ..core.db import execute, query_all, query_one
from ..core.llm import LLMError, complete
from ..core.mastery import average_mastery, fetch_course_mastery, mastery_guidance, resolve_depth
from ..rag.prompt import build_context_blocks, build_system_prompt, fallback_reply
from ..rag.retriever import retrieve

router = APIRouter()

# "auto" adapts the depth to the learner's stored topic mastery (FR-A8).
VALID_MODES = {"beginner", "intermediate", "advanced", "auto"}


def _require_user(x_user_id: Optional[str]) -> str:
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")
    return x_user_id


class CreateSessionRequest(BaseModel):
    course_id: str


class MessageRequest(BaseModel):
    message: str


class ModeRequest(BaseModel):
    mode: str


@router.post("/sessions")
def create_session(req: CreateSessionRequest, x_user_id: Optional[str] = Header(default=None)) -> dict:
    """Start a chat session scoped to a course (FR-A1)."""
    user_id = _require_user(x_user_id)
    course = query_one("SELECT id, title FROM courses WHERE id = %s", [req.course_id])
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    session = execute(
        "INSERT INTO ai_chat_sessions (user_id, course_id) VALUES (%s, %s) RETURNING *",
        [user_id, req.course_id],
    )
    return {**(session or {}), "course_title": course["title"]}


@router.get("/sessions")
def list_sessions(
    x_user_id: Optional[str] = Header(default=None), course_id: Optional[str] = None
) -> dict:
    user_id = _require_user(x_user_id)
    params: list = [user_id]
    where = "s.user_id = %s"
    if course_id:
        params.append(course_id)
        where += " AND s.course_id = %s"
    items = query_all(
        f"""
        SELECT s.id, s.course_id, s.mode, s.created_at, c.title AS course_title,
               (SELECT count(*)::int FROM ai_chat_messages m WHERE m.session_id = s.id) AS message_count
        FROM ai_chat_sessions s JOIN courses c ON c.id = s.course_id
        WHERE {where}
        ORDER BY s.created_at DESC
        """,
        params,
    )
    return {"items": items}


@router.get("/sessions/{session_id}/messages")
def list_messages(session_id: str, x_user_id: Optional[str] = Header(default=None)) -> dict:
    user_id = _require_user(x_user_id)
    session = query_one(
        "SELECT id, course_id, mode FROM ai_chat_sessions WHERE id = %s AND user_id = %s",
        [session_id, user_id],
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = query_all(
        """
        SELECT m.id, m.sender, m.content, m.source_lecture_ids, m.created_at,
               ARRAY_AGG(l.title) FILTER (WHERE l.id IS NOT NULL) AS source_lecture_titles
        FROM ai_chat_messages m
        LEFT JOIN LATERAL unnest(m.source_lecture_ids) AS sid ON TRUE
        LEFT JOIN lectures l ON l.id = sid
        WHERE m.session_id = %s
        GROUP BY m.id
        ORDER BY m.created_at ASC, m.id ASC
        """,
        [session_id],
    )

    # Attach (lecture_id, title, timestamp) citations for AI replies
    result = []
    for m in messages:
        sources = []
        if m.get("source_lecture_ids"):
            for lec_id in m["source_lecture_ids"]:
                lec = query_one("SELECT id, title, duration_seconds FROM lectures WHERE id = %s", [lec_id])
                if lec:
                    sources.append(
                        {
                            "lecture_id": lec["id"],
                            "lecture_title": lec["title"],
                            "timestamp_seconds": None,
                        }
                    )
        m["sources"] = sources
        result.append(m)
    return {"items": result, "mode": session["mode"], "course_id": session["course_id"]}


@router.post("/sessions/{session_id}/messages")
def send_message(
    session_id: str, req: MessageRequest, x_user_id: Optional[str] = Header(default=None)
) -> dict:
    """RAG-grounded reply (FR-A2): retrieve → prompt → Claude → persist."""
    user_id = _require_user(x_user_id)
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message must not be empty")

    session = query_one(
        "SELECT id, course_id, mode FROM ai_chat_sessions WHERE id = %s AND user_id = %s",
        [session_id, user_id],
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    course = query_one("SELECT id, title FROM courses WHERE id = %s", [session["course_id"]])
    mode = session["mode"] or "intermediate"

    # FR-A8: "auto" picks the depth from the learner's mastery rows and
    # passes the weak-topic context into the prompt.
    guidance = ""
    if mode == "auto":
        mastery_rows = fetch_course_mastery(user_id, session["course_id"])
        depth = resolve_depth(average_mastery(mastery_rows))
        guidance = mastery_guidance(mastery_rows)
    else:
        depth = mode

    # Step 2: similarity search scoped to this course (PRD §9.2)
    chunks = retrieve(session["course_id"], req.message)

    # Steps 3-4: assemble prompt, call the LLM, store messages.
    # Any provider failure degrades to the extractive offline answer so the
    # tutor always responds (doubt-resolution latency is a KPI).
    if get_settings().llm_available:
        try:
            reply = complete(
                build_system_prompt(
                    course["title"], depth, build_context_blocks(chunks), guidance
                ),
                [{"role": "user", "content": req.message}],
            )
        except LLMError:
            reply = fallback_reply(chunks)
    else:
        reply = fallback_reply(chunks)

    # Unique lecture citations among retrieved chunks (keep top-k order)
    source_ids: list[str] = []
    source_meta = []
    for chunk in chunks:
        lec_id = chunk.get("lecture_id")
        if lec_id and lec_id not in source_ids:
            source_ids.append(lec_id)
            source_meta.append(
                {
                    "lecture_id": lec_id,
                    "lecture_title": chunk.get("lecture_title"),
                    "timestamp_seconds": chunk.get("timestamp_seconds"),
                }
            )

    execute(
        "INSERT INTO ai_chat_messages (session_id, sender, content) VALUES (%s, 'user', %s)",
        [session_id, req.message],
    )
    execute(
        """
        INSERT INTO ai_chat_messages (session_id, sender, content, source_lecture_ids)
        VALUES (%s, 'ai', %s, %s)
        """,
        [session_id, reply, source_ids],
    )

    return {"reply": reply, "sources": source_meta, "mode": mode, "depth": depth}


@router.put("/sessions/{session_id}/mode")
def set_mode(
    session_id: str, req: ModeRequest, x_user_id: Optional[str] = Header(default=None)
) -> dict:
    """Switch explanation depth (FR-A6)."""
    user_id = _require_user(x_user_id)
    if req.mode not in VALID_MODES:
        raise HTTPException(
            status_code=400, detail=f"mode must be one of {sorted(VALID_MODES)}"
        )
    session = query_one(
        "SELECT id FROM ai_chat_sessions WHERE id = %s AND user_id = %s",
        [session_id, user_id],
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    execute("UPDATE ai_chat_sessions SET mode = %s WHERE id = %s", [req.mode, session_id])
    return {"session_id": session_id, "mode": req.mode}
