"""Topic-mastery → difficulty resolution (FR-A8 feeding FR-A6).

The Node backend maintains `topic_mastery` rows (one per learner + module,
recomputed by a background job after quizzes, completions and tutor
interactions). This module reads those rows so the tutor's adaptive mode and
auto-generated quizzes can pitch to the learner's actual level.

Bands must stay identical to `backend/src/utils/mastery.ts` — the demo mode
mirrors them a third time in `frontend/src/services/demo/`.
"""

from typing import List, Optional

from .db import query_all

LOW_BAND = 55.0   # below → beginner
HIGH_BAND = 80.0  # below → intermediate, at/above → advanced


def resolve_depth(mastery: Optional[float]) -> str:
    """Map a 0-100 mastery score to a difficulty band (pure, unit tested)."""
    if mastery is None:
        return "intermediate"
    try:
        score = float(mastery)
    except (TypeError, ValueError):
        return "intermediate"
    if score < LOW_BAND:
        return "beginner"
    if score < HIGH_BAND:
        return "intermediate"
    return "advanced"


def fetch_course_mastery(user_id: str, course_id: str) -> List[dict]:
    """Stored mastery rows for this learner in this course, weakest first."""
    return query_all(
        """
        SELECT tm.module_id, m.title AS module_title, tm.mastery_score,
               tm.quiz_avg, tm.completion_percent, tm.attempts
        FROM topic_mastery tm
        JOIN modules m ON m.id = tm.module_id
        WHERE tm.user_id = %s AND tm.course_id = %s
        ORDER BY tm.mastery_score ASC, m.order_index
        """,
        [user_id, course_id],
    )


def average_mastery(rows: List[dict]) -> Optional[float]:
    """Mean mastery across modules, or None when there are no rows yet."""
    if not rows:
        return None
    total = sum(float(r.get("mastery_score") or 0) for r in rows)
    return round(total / len(rows), 2)


def mastery_guidance(rows: List[dict]) -> str:
    """Prompt line naming the learner's weakest/strongest topics (may be '').'"""
    if not rows:
        return ""
    weak = rows[:2]
    strong = [r for r in rows if float(r.get("mastery_score") or 0) >= HIGH_BAND][-1:]
    parts = [
        "Learner mastery for reference: "
        + ", ".join(
            f"{r['module_title']} {float(r['mastery_score']):.0f}%" for r in weak
        )
    ]
    if strong:
        parts.append(f"strongest topic: {strong[0]['module_title']}")
    parts.append("Pitch depth to the weakest topics unless asked otherwise.")
    return " ".join(parts) + "."


def quiz_difficulty(user_id: str, course_id: Optional[str], module_id: Optional[str] = None) -> str:
    """
    Difficulty band for an auto-generated quiz (FR-A8 feeding FR-A5).

    Prefers the lecture's own module when given, otherwise averages the
    course. Falls back to 'intermediate' when the learner has no mastery
    rows yet (never-taken quiz, brand-new enrolment).
    """
    if module_id:
        rows = query_all(
            "SELECT mastery_score FROM topic_mastery WHERE user_id = %s AND module_id = %s",
            [user_id, module_id],
        )
        if rows:
            return resolve_depth(average_mastery(rows))
    if course_id:
        rows = fetch_course_mastery(user_id, course_id)
        if rows:
            return resolve_depth(average_mastery(rows))
    return "intermediate"
