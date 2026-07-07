"""Tests for the apps/web <-> apps/api trust boundary (Phase 10).

Exercises the REAL require_auth dependency with real tokens (unlike
test_api.py, which bypasses auth via dependency_overrides to test /chat
and /tools's own behavior in isolation) — this file is specifically about
whether authentication itself is correct: valid tokens accepted, and every
distinct failure mode (missing, expired, bad signature, malformed,
unconfigured secret) rejected with a proper 401.

    python -m pytest apps/api/tests/test_auth.py -v
"""

import sys
import time
from pathlib import Path
from unittest.mock import patch

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import jwt
import pytest
from fastapi.testclient import TestClient

import apps.api.main as api_main
from apps.api.main import app

TEST_SECRET = "phase-10-test-secret-do-not-use-in-real-deployments"
ALGORITHM = "HS256"
ISSUER = "odoo-ai-agent-web"
AUDIENCE = "odoo-ai-agent-api"

client = TestClient(app)


@pytest.fixture(autouse=True)
def _configure_secret_and_reset_state(monkeypatch):
    monkeypatch.setenv("API_AUTH_SECRET", TEST_SECRET)
    api_main._chat_request_times.clear()
    yield


def _make_token(
    *,
    secret: str = TEST_SECRET,
    sub: str = "personal-user",
    issuer: str | None = ISSUER,
    audience: str | None = AUDIENCE,
    algorithm: str = ALGORITHM,
    expires_in_seconds: float = 300,
) -> str:
    now = int(time.time())
    payload: dict = {"iat": now, "exp": now + int(expires_in_seconds)}
    if sub is not None:
        payload["sub"] = sub
    if issuer is not None:
        payload["iss"] = issuer
    if audience is not None:
        payload["aud"] = audience
    return jwt.encode(payload, secret, algorithm=algorithm)


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _post_chat(headers: dict | None = None):
    with patch("apps.api.main.route_query", return_value={"tool": None, "parameters": {}, "result": "ok"}):
        return client.post("/chat", json={"query": "hi"}, headers=headers or {})


# ── Accepted ─────────────────────────────────────────────────────────────

def test_valid_token_is_accepted():
    resp = _post_chat(_auth_header(_make_token()))
    assert resp.status_code == 200
    assert resp.json()["success"] is True


def test_authenticated_requests_succeed_on_tools_too():
    resp = client.get("/tools", headers=_auth_header(_make_token()))
    assert resp.status_code == 200
    assert resp.json()["count"] > 0


def test_health_never_requires_a_token():
    """Docker's HEALTHCHECK hits this from inside the container with no
    token at all and no way to obtain one — must stay open."""
    resp = client.get("/health")
    assert resp.status_code == 200


def test_existing_ai_routing_still_works_with_a_valid_token():
    """Regression check: the auth dependency must not interfere with
    route_query()'s own call/response shape once a caller is authenticated."""
    canned = {"tool": "get_business_alerts", "parameters": {"limit": 10}, "result": "## Business Alerts"}
    with patch("apps.api.main.route_query", return_value=canned) as mocked:
        resp = client.post(
            "/chat",
            json={"query": "show business alerts"},
            headers=_auth_header(_make_token()),
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"success": True, "tool": "get_business_alerts", "parameters": {"limit": 10}, "result": "## Business Alerts"}
    mocked.assert_called_once()


# ── Rejected: missing ────────────────────────────────────────────────────

def test_missing_token_is_rejected():
    resp = _post_chat()
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Missing authentication token"


def test_unauthenticated_requests_fail_on_tools_too():
    resp = client.get("/tools")
    assert resp.status_code == 401


# ── Rejected: malformed ──────────────────────────────────────────────────

@pytest.mark.parametrize(
    "headers",
    [
        {"Authorization": "not-even-bearer-shaped"},
        {"Authorization": "Basic dXNlcjpwYXNz"},
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer not.a.jwt"},
        {"Authorization": "Bearer "},
    ],
)
def test_malformed_token_is_rejected(headers):
    resp = _post_chat(headers)
    assert resp.status_code == 401


# ── Rejected: expired ────────────────────────────────────────────────────

def test_expired_token_is_rejected():
    token = _make_token(expires_in_seconds=-60)
    resp = _post_chat(_auth_header(token))
    assert resp.status_code == 401
    assert "expired" in resp.json()["detail"].lower()


# ── Rejected: invalid signature ──────────────────────────────────────────

def test_invalid_signature_is_rejected():
    token = _make_token(secret="a-completely-different-secret")
    resp = _post_chat(_auth_header(token))
    assert resp.status_code == 401


def test_wrong_algorithm_is_rejected():
    # "none" alg with no signature at all is a classic JWT bypass attempt —
    # PyJWT refuses to encode it directly, so this constructs the raw
    # compact JWS manually to prove the server-side decode rejects it too.
    import base64
    import json

    header = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).rstrip(b"=")
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": "personal-user", "iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 300}).encode()
    ).rstrip(b"=")
    forged = f"{header.decode()}.{payload.decode()}."
    resp = _post_chat(_auth_header(forged))
    assert resp.status_code == 401


# ── Rejected: wrong issuer/audience (token confusion defense-in-depth) ──

def test_wrong_issuer_is_rejected():
    token = _make_token(issuer="someone-else")
    resp = _post_chat(_auth_header(token))
    assert resp.status_code == 401


def test_wrong_audience_is_rejected():
    token = _make_token(audience="someone-else")
    resp = _post_chat(_auth_header(token))
    assert resp.status_code == 401


def test_missing_subject_claim_is_rejected():
    token = _make_token(sub=None)
    resp = _post_chat(_auth_header(token))
    assert resp.status_code == 401


# ── Fails closed when unconfigured ───────────────────────────────────────

def test_fails_closed_when_secret_is_not_configured(monkeypatch):
    monkeypatch.delenv("API_AUTH_SECRET", raising=False)
    resp = _post_chat(_auth_header(_make_token()))
    assert resp.status_code == 401


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
