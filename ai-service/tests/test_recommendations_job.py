"""Nightly recommendation recalculation (PRD §9.3) and request correlation.

The batch must survive one learner failing — a single bad row or a provider
hiccup cannot cost every other learner their refreshed suggestions. The
request-id tests pin the contract the backend relies on to stitch one user
action across both services' logs.
"""

from fastapi.testclient import TestClient

from app.main import app, settings
from app.recommendation import engine

RECOMPUTE = "/api/v1/ai/internal/recommendations/recompute"


def test_recompute_all_isolates_a_failing_learner(monkeypatch):
    monkeypatch.setattr(engine, "query_all", lambda *_a, **_k: [{"id": "a"}, {"id": "b"}, {"id": "c"}])
    seen = []

    def fake_build(user_id):
        seen.append(user_id)
        if user_id == "b":
            raise RuntimeError("embedding provider down")
        return {"items": []}

    monkeypatch.setattr(engine, "build_recommendations", fake_build)
    assert engine.recompute_all() == {"users": 3, "updated": 2, "failed": 1}
    assert seen == ["a", "b", "c"]


def test_recompute_all_with_no_learners(monkeypatch):
    monkeypatch.setattr(engine, "query_all", lambda *_a, **_k: [])
    assert engine.recompute_all() == {"users": 0, "updated": 0, "failed": 0}


def test_recompute_endpoint_requires_the_internal_token(monkeypatch):
    monkeypatch.setattr(settings, "internal_api_token", "s3cret")
    client = TestClient(app, raise_server_exceptions=False)
    assert client.post(RECOMPUTE).status_code == 401


def test_recompute_endpoint_returns_the_batch_summary(monkeypatch):
    monkeypatch.setattr(settings, "internal_api_token", "s3cret")
    from app.routers import recommendations

    monkeypatch.setattr(recommendations, "recompute_all", lambda: {"users": 1, "updated": 1, "failed": 0})
    client = TestClient(app)
    res = client.post(RECOMPUTE, headers={"x-internal-token": "s3cret"})
    assert res.status_code == 200
    assert res.json() == {"users": 1, "updated": 1, "failed": 0}


def test_inbound_request_id_is_echoed():
    res = TestClient(app).get("/health", headers={"x-request-id": "req-abc_123"})
    assert res.headers["x-request-id"] == "req-abc_123"


def test_unsafe_request_id_is_replaced():
    res = TestClient(app).get("/health", headers={"x-request-id": 'bad"id\nlog-injection'})
    rid = res.headers["x-request-id"]
    assert rid != 'bad"id\nlog-injection'
    assert len(rid) == 36  # fresh uuid4


def test_rejected_requests_still_carry_an_id(monkeypatch):
    monkeypatch.setattr(settings, "internal_api_token", "s3cret")
    res = TestClient(app, raise_server_exceptions=False).post(RECOMPUTE)
    assert res.status_code == 401
    assert res.headers.get("x-request-id")
