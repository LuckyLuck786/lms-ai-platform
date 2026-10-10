import json
import re
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..core.config import get_settings
from ..core.db import execute, query_all, query_one
from ..core.llm import LLMError, complete
from ..core.mastery import quiz_difficulty

router = APIRouter()

BASE_SYSTEM = (
    "You create quiz questions from lecture transcripts. "
    "Return ONLY minified JSON of the shape "
    '{"questions":[{"question_text":"...","question_type":"mcq",'
    '"options":[{"option_text":"...","is_correct":true},...]}]}. '
    "Rules: 5-8 questions; question_type is mcq, multi_select or short_answer; "
    "mcq needs exactly one correct option; multi_select needs 1-3 correct options; "
    "short_answer needs an empty options array. Base every question strictly on the transcript."
)

DIFFICULTY_INSTRUCTIONS = {
    "beginner": (
        "Set the difficulty to beginner: recall-level questions about definitions "
        "and single-step ideas; no trick distractors."
    ),
    "intermediate": (
        "Set the difficulty to intermediate: apply concepts to typical scenarios; "
        "use plausible but clearly-wrong distractors."
    ),
    "advanced": (
        "Set the difficulty to advanced: multi-step reasoning, edge cases and "
        "trade-offs; distractors should be subtle and defensible."
    ),
}


def system_prompt(difficulty: str) -> str:
    return f"{BASE_SYSTEM} {DIFFICULTY_INSTRUCTIONS.get(difficulty, DIFFICULTY_INSTRUCTIONS['intermediate'])}"


class GenerateQuizRequest(BaseModel):
    # Optional override; when absent the band comes from the learner's
    # topic-mastery rows (FR-A8 feeding FR-A5).
    difficulty: Optional[str] = None


def _parse_quiz_json(raw: str) -> list[dict]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(json)?\n?|\n?```$", "", text)
    match = re.search(r"\{.*\}", text, re.S)
    data = json.loads(match.group(0) if match else text)
    questions = data.get("questions", [])
    if not isinstance(questions, list) or not questions:
        raise ValueError("no questions in model output")
    return questions[:10]


def _fallback_questions(transcript: str) -> list[dict]:
    """No LLM key: derive short-answer prompts from transcript sentences so the
    instructor review flow still works end to end."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", transcript) if len(s.strip()) > 40]
    questions = [
        {
            "question_text": f"Explain in your own words: “{s[:140]}…”",
            "question_type": "short_answer",
            "options": [],
        }
        for s in sentences[:5]
    ]
    return questions or [
        {
            "question_text": "Summarize this lecture's key idea.",
            "question_type": "short_answer",
            "options": [],
        }
    ]


@router.post("/lectures/{lecture_id}/generate-quiz")
def generate_quiz(
    lecture_id: str,
    req: GenerateQuizRequest = GenerateQuizRequest(),
    x_user_id: Optional[str] = Header(default=None),
) -> dict:
    """POST /api/v1/ai/lectures/:id/generate-quiz — FR-A5.

    Persists a draft quiz (is_ai_generated = true) on the lecture's module
    for the instructor to review and approve (FR-I4). The difficulty band
    honours an explicit request, otherwise it derives from the requesting
    learner's topic mastery (FR-A8).
    """
    lecture = query_one(
        """
        SELECT l.id, l.title, l.transcript, m.id AS module_id, m.course_id
        FROM lectures l JOIN modules m ON m.id = l.module_id
        WHERE l.id = %s
        """,
        [lecture_id],
    )
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    transcript = lecture.get("transcript") or ""
    if not transcript.strip():
        raise HTTPException(status_code=400, detail="Lecture has no transcript")

    # Difficulty: explicit > mastery-derived > intermediate.
    requested = (req.difficulty or "").lower()
    if requested in DIFFICULTY_INSTRUCTIONS:
        difficulty = requested
    elif x_user_id:
        difficulty = quiz_difficulty(x_user_id, lecture["course_id"], lecture["module_id"])
    else:
        difficulty = "intermediate"

    demo_mode = False
    if get_settings().llm_available:
        try:
            raw = complete(
                system_prompt(difficulty),
                [{"role": "user", "content": f"Transcript of “{lecture['title']}”:\n\n{transcript}"}],
                max_tokens=2000,
            )
            questions = _parse_quiz_json(raw)
        except (LLMError, ValueError, KeyError, TypeError):
            questions = _fallback_questions(transcript)
            demo_mode = True
    else:
        questions = _fallback_questions(transcript)
        demo_mode = True

    quiz = execute(
        """
        INSERT INTO quizzes (module_id, title, is_ai_generated, generated_from_lecture_id)
        VALUES (%s, %s, TRUE, %s) RETURNING *
        """,
        [lecture["module_id"], f"AI draft: {lecture['title']}", lecture_id],
    )
    quiz_id = quiz["id"]

    created = []
    for idx, q in enumerate(questions):
        qtype = q.get("question_type", "mcq")
        if qtype not in {"mcq", "multi_select", "short_answer"}:
            qtype = "mcq"
        row = execute(
            """
            INSERT INTO quiz_questions (quiz_id, question_text, question_type, order_index)
            VALUES (%s, %s, %s, %s) RETURNING id
            """,
            [quiz_id, q.get("question_text", ""), qtype, idx],
        )
        for opt in q.get("options", [])[:10]:
            execute(
                "INSERT INTO quiz_options (question_id, option_text, is_correct) VALUES (%s, %s, %s)",
                [row["id"], opt.get("option_text", ""), bool(opt.get("is_correct", False))],
            )
        created.append(row["id"])

    return {
        "quiz_id": quiz_id,
        "title": quiz["title"],
        "question_count": len(created),
        "is_ai_generated": True,
        "difficulty": difficulty,
        "demo_mode": demo_mode,
        "message": "Draft created for instructor review.",
    }


@router.get("/quizzes/{quiz_id}/review")
def review_quiz(quiz_id: str) -> dict:
    """Instructor review payload for an AI-generated draft (includes answers)."""
    quiz = query_one("SELECT * FROM quizzes WHERE id = %s", [quiz_id])
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    questions = query_all(
        "SELECT id, question_text, question_type, order_index FROM quiz_questions WHERE quiz_id = %s ORDER BY order_index",
        [quiz_id],
    )
    for q in questions:
        q["options"] = query_all(
            "SELECT id, option_text, is_correct FROM quiz_options WHERE question_id = %s",
            [q["id"]],
        )
    return {**quiz, "questions": questions}
