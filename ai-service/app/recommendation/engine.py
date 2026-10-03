"""Personalized recommendations (FR-S10, PRD §8.6).

Blend of:
1. Rule signals — category affinity from enrollments, weak-area coverage,
   difficulty fit against the learner's average quiz score, popularity.
2. Embedding similarity — the learner's profile text (enrolled course titles
   + weak topics) vs each candidate course's title/description.
"""

from ..core.db import execute, query_all
from ..rag.embeddings import embed

WEAK_THRESHOLD = 70.0
TOP_N = 8


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5 or 1.0
    nb = sum(y * y for y in b) ** 0.5 or 1.0
    return dot / (na * nb)


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def build_recommendations(user_id: str) -> dict:
    enrollments = query_all(
        """
        SELECT c.id, c.title, c.category, c.difficulty,
               COALESCE(e.progress_percent, 0)::float AS progress
        FROM enrollments e JOIN courses c ON c.id = e.course_id
        WHERE e.user_id = %s
        """,
        [user_id],
    )
    enrolled_ids = {e["id"] for e in enrollments}
    enrolled_categories = {e["category"] for e in enrollments if e["category"]}

    # Quiz performance per course → weak categories
    perf = query_all(
        """
        SELECT c.category, AVG(qa.score)::float AS avg_score
        FROM quiz_attempts qa
        JOIN quizzes q ON q.id = qa.quiz_id
        JOIN modules m ON m.id = q.module_id
        JOIN courses c ON c.id = m.course_id
        WHERE qa.user_id = %s AND qa.submitted_at IS NOT NULL AND qa.score IS NOT NULL
        GROUP BY c.category
        """,
        [user_id],
    )
    weak_categories = {p["category"] for p in perf if (p["avg_score"] or 0) < WEAK_THRESHOLD}
    avg_score = sum(p["avg_score"] or 0 for p in perf) / len(perf) if perf else None

    candidates = query_all(
        """
        SELECT c.id, c.title, c.description, c.category, c.difficulty, c.price,
               u.full_name AS instructor_name,
               (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id) AS enrollment_count
        FROM courses c JOIN users u ON u.id = c.instructor_id
        WHERE c.status = 'approved'
          AND c.instructor_id <> %s
          AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.user_id = %s)
        """,
        [user_id, user_id],
    )
    if not candidates:
        return {"items": [], "reason": "no candidates" if not enrollments else "all enrolled"}

    # Learner profile embedding: enrolled courses + weak topics
    profile_text = " ".join(
        [e["title"] for e in enrollments]
        + [f"needs practice in {c}" for c in weak_categories]
    ) or "general interest in online learning"
    profile_vec = embed(profile_text)

    max_enroll = max((c["enrollment_count"] for c in candidates), default=1) or 1
    results = []
    for course in candidates:
        # Rule signals
        rule = 0.0
        reasons = []
        if course["category"] and course["category"] in enrolled_categories:
            rule += 25
            reasons.append(f"matches your enrolled category “{course['category']}”")
        if course["category"] and course["category"] in weak_categories:
            rule += 30
            reasons.append("targets a weak area from your quiz results")
        if avg_score is not None and avg_score < WEAK_THRESHOLD and course["difficulty"] == "beginner":
            rule += 15
            reasons.append("beginner-friendly pacing fits your recent scores")
        popularity = 20 * (course["enrollment_count"] / max_enroll)
        rule += popularity
        if course["enrollment_count"] > 0:
            reasons.append(f"popular with {course['enrollment_count']} learners")

        # Embedding similarity (0..1 → 0..30 points)
        course_vec = embed(f"{course['title']} {course['description'] or ''}")
        similarity = _cosine(profile_vec, course_vec)
        rule += _clamp(similarity, 0, 1) * 30

        results.append(
            {
                "course": course,
                "score": round(_clamp(rule), 2),
                "similarity": round(similarity, 4),
                "reason": "; ".join(reasons) if reasons else "general match to your profile",
            }
        )

    results.sort(key=lambda r: r["score"], reverse=True)
    top = results[:TOP_N]

    # Persist for the platform's recommendation table (replace previous set)
    execute("DELETE FROM recommendations WHERE user_id = %s", [user_id])
    for r in top:
        execute(
            """
            INSERT INTO recommendations (user_id, recommended_course_id, reason, score)
            VALUES (%s, %s, %s, %s)
            """,
            [user_id, r["course"]["id"], r["reason"], r["score"]],
        )

    return {
        "items": [
            {
                "course_id": r["course"]["id"],
                "title": r["course"]["title"],
                "category": r["course"]["category"],
                "difficulty": r["course"]["difficulty"],
                "instructor_name": r["course"]["instructor_name"],
                "score": r["score"],
                "similarity": r["similarity"],
                "reason": r["reason"],
            }
            for r in top
        ]
    }
