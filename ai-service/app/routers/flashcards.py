import json
import re

from fastapi import APIRouter, HTTPException

from ..core.config import get_settings
from ..core.db import execute, query_all, query_one
from ..core.llm import LLMError, complete

router = APIRouter()

SYSTEM = (
    "You create spaced-revision flashcards from course material. "
    "Return ONLY minified JSON: {\"cards\":[{\"question\":\"...\",\"answer\":\"...\"}]}. "
    "Create 5-10 precise Q/A pairs based strictly on the provided transcripts."
)


def _parse_cards(raw: str) -> list[dict]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(json)?\n?|\n?```$", "", text)
    match = re.search(r"\{.*\}", text, re.S)
    data = json.loads(match.group(0) if match else text)
    cards = data.get("cards", [])
    if not isinstance(cards, list) or not cards:
        raise ValueError("no cards")
    return cards[:12]


def _fallback_cards(lectures: list[dict]) -> list[dict]:
    cards = []
    for lec in lectures:
        transcript = (lec.get("transcript") or "").strip()
        if not transcript:
            continue
        first_sentence = re.split(r"(?<=[.!?])\s+", transcript)[0][:180]
        cards.append(
            {
                "question": f"State the main point of “{lec['title']}”",
                "answer": first_sentence,
            }
        )
    return cards or [{"question": "Course overview?", "answer": "No transcripts available yet."}]


@router.post("/modules/{module_id}/flashcards")
def generate_flashcards(module_id: str) -> dict:
    """POST /api/v1/ai/modules/:id/flashcards — FR-A7 (persists to flashcards)."""
    module = query_one("SELECT id, title, course_id FROM modules WHERE id = %s", [module_id])
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    lectures = query_all(
        "SELECT id, title, transcript FROM lectures WHERE module_id = %s ORDER BY order_index",
        [module_id],
    )
    material = "\n\n".join(
        f"Lecture “{lec['title']}”:\n{lec.get('transcript') or ''}"
        for lec in lectures
    ).strip()
    if not material:
        raise HTTPException(status_code=400, detail="Module has no transcripts")

    demo_mode = False
    if get_settings().llm_available:
        try:
            raw = complete(
                SYSTEM,
                [{"role": "user", "content": material}],
                max_tokens=2000,
            )
            cards = _parse_cards(raw)
        except (LLMError, ValueError, KeyError, TypeError):
            cards = _fallback_cards(lectures)
            demo_mode = True
    else:
        cards = _fallback_cards(lectures)
        demo_mode = True

    # Replace any previous generated set for this module (idempotent)
    execute("DELETE FROM flashcards WHERE module_id = %s", [module_id])
    created = [
        execute(
            "INSERT INTO flashcards (module_id, question, answer) VALUES (%s, %s, %s) RETURNING id",
            [module_id, c.get("question", ""), c.get("answer", "")],
        )
        for c in cards
    ]

    return {
        "module_id": module_id,
        "cards": cards,
        "count": len(created),
        "demo_mode": demo_mode,
    }
