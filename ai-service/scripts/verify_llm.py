"""Verify the AI service talks to a real LLM provider (no offline fallback).

Run from ai-service/:  .venv/bin/python scripts/verify_llm.py

Prints the resolved provider, does one short grounded answer, and embeds a
sentence. Exits non-zero if any step fell back or errored, so it can gate a
deploy.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.llm import LLMError, complete, get_provider  # noqa: E402
from app.rag.embeddings import embed, embedding_provider  # noqa: E402


def main() -> int:
    settings = get_settings()
    provider = get_provider()
    print(f"groq_model       = {settings.groq_model}")
    print(f"gemini_model     = {settings.gemini_model}")
    print(f"embedding_model  = {settings.embedding_model}")
    print(f"resolved provider= {provider}")
    print(f"embedding provider= {embedding_provider()}")
    if provider is None:
        print("FAIL: no LLM provider key configured")
        return 1

    ok = True

    try:
        answer = complete(
            "You are a concise tutor. Answer in one sentence.",
            [{"role": "user", "content": "Why does a B-tree beat a binary search tree on disk?"}],
            max_tokens=200,
        )
        print(f"\n[chat via {provider}]\n{answer}\n")
        if not answer.strip() or answer.startswith("[AI tutor is not configured]"):
            print("FAIL: chat returned no real answer")
            ok = False
    except LLMError as exc:
        print(f"FAIL: chat raised {exc}")
        ok = False

    vector = embed("B-tree indexes reduce disk seeks in a database.")
    print(f"[embedding] dims={len(vector)} provider={embedding_provider()}")
    if len(vector) != 1536:
        print("FAIL: embedding is not 1536-dim")
        ok = False

    print("\nRESULT:", "OK — real provider output" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
