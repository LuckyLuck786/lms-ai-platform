import json
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..core.db import execute, query_all

router = APIRouter()

WEAK_THRESHOLD = 70.0  # module avg below this is flagged weak


class StudyPlanRequest(BaseModel):
    course_id: Optional[str] = None


@router.post("/study-plan")
def generate_study_plan(
    req: StudyPlanRequest, x_user_id: Optional[str] = Header(default=None)
) -> dict:
    """POST /api/v1/ai/study-plan — FR-A4: personalized plan from quiz history.

    Rule-based by design (deterministic, no LLM dependency): weak modules are
    ranked by how far they fall below the mastery threshold, then healthy
    modules follow to keep a study rhythm.
    """
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")

    course_filter = "AND c.id = %s" if req.course_id else ""

    module_stats = query_all(
        f"""
        SELECT m.id AS module_id, m.title, c.id AS course_id, c.title AS course_title,
               COALESCE(AVG(qa.score), 0)::float AS avg_score,
               COUNT(qa.id)::int AS attempts
        FROM modules m
        JOIN courses c ON c.id = m.course_id
        JOIN enrollments e ON e.course_id = c.id AND e.user_id = %s
        LEFT JOIN quizzes q ON q.module_id = m.id
        LEFT JOIN quiz_attempts qa ON qa.quiz_id = q.id AND qa.user_id = %s AND qa.submitted_at IS NOT NULL
        WHERE c.status = 'approved' {course_filter}
        GROUP BY m.id, m.title, c.id, c.title
        ORDER BY c.title, m.title
        """,
        [x_user_id, x_user_id, *([req.course_id] if req.course_id else [])],
    )
    if not module_stats:
        raise HTTPException(status_code=404, detail="No enrolled courses to plan for")

    weak = [m for m in module_stats if m["attempts"] == 0 or m["avg_score"] < WEAK_THRESHOLD]
    healthy = [m for m in module_stats if m not in weak]
    weak.sort(key=lambda m: m["avg_score"])

    items = []
    for rank, m in enumerate(weak, start=1):
        if m["attempts"] == 0:
            reason = "No quiz attempts yet — review the material and take the quiz."
            priority = "high"
        else:
            gap = round(WEAK_THRESHOLD - m["avg_score"], 1)
            reason = f"Average score {m['avg_score']:.1f}% ({gap} pts below the {WEAK_THRESHOLD:.0f}% target)."
            priority = "high" if m["avg_score"] < 50 else "medium"
        items.append(
            {
                "module_id": m["module_id"],
                "module_title": m["title"],
                "course_id": m["course_id"],
                "course_title": m["course_title"],
                "priority": priority,
                "rank": rank,
                "avg_score": round(m["avg_score"], 1),
                "reason": reason,
                "actions": [
                    f"Re-watch the lectures in “{m['title']}”",
                    "Ask the AI tutor about the concepts that felt unclear",
                    "Retake the module quiz",
                ],
                "estimated_minutes": 30 + rank * 5,
            }
        )

    for m in healthy:
        items.append(
            {
                "module_id": m["module_id"],
                "module_title": m["title"],
                "course_id": m["course_id"],
                "course_title": m["course_title"],
                "priority": "low",
                "rank": len(items) + 1,
                "avg_score": round(m["avg_score"], 1),
                "reason": f"Solid grasp ({m['avg_score']:.1f}%) — keep it fresh.",
                "actions": ["Quick flashcard revision"],
                "estimated_minutes": 15,
            }
        )

    plan = {
        "focus": "weak_modules_first",
        "weak_module_count": len(weak),
        "items": items,
    }

    execute(
        "INSERT INTO study_plans (user_id, course_id, plan_json) VALUES (%s, %s, %s)",
        [x_user_id, req.course_id, json.dumps(plan, default=str)],
    )
    return {"plan": plan, "generated_for": x_user_id}
