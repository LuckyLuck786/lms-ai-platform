"""Prompt assembly for grounded tutoring answers (PRD §9.2 step 3)."""

MODE_INSTRUCTIONS = {
    "beginner": (
        "Explain like the learner has no background in the subject: use plain "
        "language, short sentences, and one concrete everyday analogy. Keep it under 120 words."
    ),
    "intermediate": (
        "Explain at an intermediate level: cover the key mechanism and a brief "
        "example. Assume the learner knows the course prerequisites."
    ),
    "advanced": (
        "Explain at an advanced level: include edge cases, complexity or trade-offs, "
        "and precise technical terminology. Be thorough but structured."
    ),
}


def build_system_prompt(course_title: str, mode: str, context_blocks: list[str]) -> str:
    context = "\n\n".join(context_blocks) or "(no course material was retrieved)"
    depth = MODE_INSTRUCTIONS.get(mode, MODE_INSTRUCTIONS["intermediate"])
    return (
        f"You are the AI tutor for the course “{course_title}”. "
        f"Answer ONLY using the CONTEXT excerpts below — never invent facts that are not there. "
        f"If the context does not contain the answer, say that this isn't covered by the course "
        f"material yet and suggest which lecture might be relevant. "
        f"When you use a lecture, mention its title so the learner can find it. "
        f"{depth}\n\n"
        f"CONTEXT:\n{context}"
    )


def build_context_blocks(chunks: list[dict]) -> list[str]:
    blocks = []
    for i, chunk in enumerate(chunks, start=1):
        title = chunk.get("lecture_title") or "Untitled lecture"
        blocks.append(f"[{i}] Lecture “{title}”:\n{chunk['chunk_text']}")
    return blocks


def fallback_reply(chunks: list[dict]) -> str:
    """Offline answer when no LLM key is configured: surface the best-matching
    course material directly so citations still demonstrate the RAG pipeline."""
    if not chunks:
        return (
            "The AI tutor has no ingested material for this course yet, and no "
            "ANTHROPIC_API_KEY is configured. Add lecture transcripts to enable answers."
        )
    best = chunks[0]
    title = best.get("lecture_title") or "a lecture"
    excerpt = best["chunk_text"]
    if len(excerpt) > 600:
        excerpt = excerpt[:600].rsplit(" ", 1)[0] + "…"
    return (
        f"(Demo mode — set ANTHROPIC_API_KEY for full Claude answers.) "
        f"From the course material in “{title}”:\n\n{excerpt}"
    )
