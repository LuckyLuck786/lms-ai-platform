"""Service-to-service auth: the X-Internal-Token guard on /api/v1/ai.

The AI service is internal — the backend is its only caller — but it is
reachable over the network, so `POST /api/v1/ai/internal/ingest` would let a
third party write into the RAG corpus and the chat routes would let them spend
the LLM budget. With a token configured every AI route must demand it; with no
token configured local development must keep working unchanged. Health checks
stay open either way so a probe can never be locked out.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app, settings

INGEST = "/api/v1/ai/internal/ingest"


# A well-formed id, so a request that clears the guard reaches the route and
# fails there (404 for a missing lecture) instead of erroring on the parameter.
LECTURE = "00000000-0000-0000-0000-000000000000"


@pytest.fixture()
def client():
    # `raise_server_exceptions=False` keeps this test about the auth guard: a
    # downstream failure (no database in CI, missing lecture locally) surfaces
    # as a 5xx/4xx response, so `status != 401` measures exactly what it claims.
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def secured(monkeypatch):
    """Configure a token for the duration of one test."""
    monkeypatch.setattr(settings, "internal_api_token", "s3cret-internal-token")
    return "s3cret-internal-token"


@pytest.fixture()
def unsecured(monkeypatch):
    """Explicitly the local-development case: no token configured."""
    monkeypatch.setattr(settings, "internal_api_token", "")
    return ""


class TestTokenEnforced:
    def test_rejects_a_request_with_no_token(self, client, secured):
        res = client.post(INGEST, json={"lecture_id": LECTURE})
        assert res.status_code == 401
        assert "X-Internal-Token" in res.json()["detail"]

    def test_rejects_a_wrong_token(self, client, secured):
        res = client.post(INGEST, json={"lecture_id": LECTURE}, headers={"x-internal-token": "not-it"})
        assert res.status_code == 401

    def test_rejects_a_token_that_is_only_a_prefix(self, client, secured):
        # Guards against a comparison that degrades to startswith().
        res = client.post(INGEST, json={"lecture_id": LECTURE}, headers={"x-internal-token": "s3cret"})
        assert res.status_code == 401

    def test_rejects_before_the_body_is_ever_parsed(self, client, secured):
        # An unauthenticated caller must not be able to make the service work:
        # not even validation runs, so a malformed body still yields 401.
        res = client.post(INGEST, json={})
        assert res.status_code == 401

    def test_admits_the_correct_token(self, client, secured):
        res = client.post(INGEST, json={"lecture_id": LECTURE}, headers={"x-internal-token": secured})
        # Past the guard: whatever the route answers, it is not a 401.
        assert res.status_code != 401

    def test_guards_every_ai_route_not_just_ingest(self, client, secured):
        assert client.get("/api/v1/ai/recommendations").status_code == 401
        assert client.get("/api/v1/ai/chat/sessions").status_code == 401

    def test_health_and_root_stay_open(self, client, secured):
        assert client.get("/health").status_code == 200
        assert client.get("/").status_code == 200


class TestTokenOptionalLocally:
    def test_requests_pass_when_no_token_is_configured(self, client, unsecured):
        res = client.post(INGEST, json={"lecture_id": LECTURE})
        assert res.status_code != 401

    def test_an_incoming_token_is_ignored_when_none_is_configured(self, client, unsecured):
        res = client.post(INGEST, json={"lecture_id": LECTURE}, headers={"x-internal-token": "whatever"})
        assert res.status_code != 401
