"""Socratic tutoring, quiz-mistake explanations and flashcard reuse."""

from fastapi.testclient import TestClient

from app.main import app, settings
from app.rag.prompt import SOCRATIC_INSTRUCTIONS, build_system_prompt
from app.routers import explain as explain_router
from app.routers import flashcards as flashcards_router


def test_socratic_style_adds_guiding_question_instructions():
    direct = build_system_prompt("DSA", "intermediate", ["[1] ctx"])
    socratic = build_system_prompt("DSA", "intermediate", ["[1] ctx"], style="socratic")
    assert SOCRATIC_INSTRUCTIONS not in direct
    assert SOCRATIC_INSTRUCTIONS in socratic
    assert "ONLY using the CONTEXT" in socratic  # still grounded in course material


def test_mode_endpoint_rejects_unknown_style_and_empty_body(monkeypatch):
    monkeypatch.setattr(settings, "internal_api_token", "")
    client = TestClient(app, raise_server_exceptions=False)
    headers = {"x-user-id": "00000000-0000-0000-0000-000000000001"}
    url = "/api/v1/ai/chat/sessions/00000000-0000-0000-0000-000000000002/mode"
    assert client.put(url, json={"style": "lecture"}, headers=headers).status_code == 400
    assert client.put(url, json={}, headers=headers).status_code == 400


def _explain_body():
    return {
        "course_id": "c1",
        "course_title": "DSA",
        "question_text": "Worst case of naive quicksort?",
        "question_type": "mcq",
        "options": [
            {"text": "O(n^2)", "is_correct": True, "chosen": False},
            {"text": "O(n)", "is_correct": False, "chosen": True},
        ],
    }


def test_explain_without_llm_names_the_correct_answer_and_cites_a_lecture(monkeypatch):
    monkeypatch.setattr(settings, "internal_api_token", "")
    monkeypatch.setattr(type(settings), "llm_available", property(lambda _self: False))
    monkeypatch.setattr(
        explain_router,
        "retrieve",
        lambda *_a, **_k: [
            {"lecture_id": "l1", "lecture_title": "Quicksort", "chunk_text": "Pivot choice matters.", "similarity": 0.8}
        ],
    )
    res = TestClient(app).post("/api/v1/ai/internal/explain", json=_explain_body())
    assert res.status_code == 200
    body = res.json()
    assert "O(n^2)" in body["explanation"]
    assert body["sources"] == [{"lecture_id": "l1", "lecture_title": "Quicksort"}]


def test_explain_prompt_states_the_learners_answer_and_the_right_one(monkeypatch):
    monkeypatch.setattr(settings, "internal_api_token", "")
    monkeypatch.setattr(type(settings), "llm_available", property(lambda _self: True))
    monkeypatch.setattr(explain_router, "retrieve", lambda *_a, **_k: [])
    seen = {}

    def fake_complete(system, messages, max_tokens=0):
        seen["system"], seen["user"] = system, messages[-1]["content"]
        return "Because sorted input makes every partition lopsided."

    monkeypatch.setattr(explain_router, "complete", fake_complete)
    res = TestClient(app).post("/api/v1/ai/internal/explain", json=_explain_body())
    assert res.json()["explanation"].startswith("Because")
    assert "Learner's answer: O(n)" in seen["user"]
    assert "Correct answer: O(n^2)" in seen["user"]


def test_flashcards_are_reused_so_review_history_survives(monkeypatch):
    monkeypatch.setattr(settings, "internal_api_token", "")
    monkeypatch.setattr(flashcards_router, "query_one", lambda *_a, **_k: {"id": "m1", "title": "M", "course_id": "c"})
    monkeypatch.setattr(
        flashcards_router, "query_all", lambda *_a, **_k: [{"id": "f1", "question": "Q?", "answer": "A."}]
    )

    def must_not_write(*_a, **_k):
        raise AssertionError("existing cards must not be deleted or regenerated")

    monkeypatch.setattr(flashcards_router, "execute", must_not_write)
    res = TestClient(app).post("/api/v1/ai/modules/m1/flashcards")
    assert res.status_code == 200
    assert res.json()["reused"] is True
    assert res.json()["cards"][0]["question"] == "Q?"


def test_unrelated_material_is_never_cited(monkeypatch):
    """Below the similarity cut-off a chunk is not about the question, so it
    must not be used or named — this is what stopped the tutor citing an
    unrelated lecture on staging."""
    from app.rag import retriever

    monkeypatch.setattr(retriever, "embedding_provider", lambda: "gemini")
    chunks = [
        {"lecture_id": "a", "similarity": 0.70},
        {"lecture_id": "b", "similarity": 0.51},
        {"lecture_id": "c", "similarity": None},
    ]
    assert [c["lecture_id"] for c in retriever.relevant(chunks)] == ["a"]

    # The offline hash embeddings have no meaningful scale: keep everything.
    monkeypatch.setattr(retriever, "embedding_provider", lambda: "local-fallback")
    assert len(retriever.relevant(chunks)) == 3
