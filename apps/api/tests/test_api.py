"""Basic tests for the FastAPI backend.

Covers: health endpoint, chat request schema validation, the defensive
history filter, and /chat's wiring to route_query() (mocked — these tests
must not require a live OpenAI key or Odoo connection to pass).

    python -m pytest apps/api/tests -v
"""

import sys
import time
from pathlib import Path
from unittest.mock import patch

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import apps.api.main as api_main
from apps.api.auth import AuthenticatedUser, require_auth
from apps.api.main import app, filter_history, _OMITTED_NOTE
from apps.api.schemas import ChatMessage, ChatRequest

client = TestClient(app)


@pytest.fixture(autouse=True)
def _bypass_auth():
    """This file tests /chat and /tools's OWN behavior (routing, history
    filtering, size limits, rate limiting) — not authentication itself,
    which has its own dedicated, thorough test file (test_auth.py) that
    exercises the real require_auth dependency with real tokens. Using
    FastAPI's own dependency_overrides mechanism here is the standard,
    documented way to bypass a dependency for tests that are about
    something else, rather than minting a real token in every single test
    in this file."""
    app.dependency_overrides[require_auth] = lambda: AuthenticatedUser(user_id="test-user")
    yield
    app.dependency_overrides.pop(require_auth, None)


@pytest.fixture(autouse=True)
def _reset_chat_rate_limit():
    """The /chat rate limiter (module-level, global — see main.py) must not
    leak state between tests, or earlier tests' calls would count toward
    later tests' limits regardless of execution order."""
    api_main._chat_request_times.clear()
    yield


# ── /health ───────────────────────────────────────────────────────────────

def test_health_endpoint():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "service": "odoo-bi-api"}


# ── /tools ────────────────────────────────────────────────────────────────

def test_tools_endpoint_matches_registry():
    from src.agent.tool_registry import TOOL_REGISTRY
    resp = client.get("/tools")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == len(TOOL_REGISTRY)
    assert set(body["tools"]) == set(TOOL_REGISTRY.keys())


# ── Chat request schema ──────────────────────────────────────────────────

def test_chat_request_schema_valid_minimal():
    req = ChatRequest(query="show business alerts")
    assert req.query == "show business alerts"
    assert req.history is None


def test_chat_request_schema_valid_with_history():
    req = ChatRequest(
        query="show unpaid invoices too",
        history=[{"role": "user", "content": "how much does Apple Mart owe?"}],
    )
    assert len(req.history) == 1
    assert req.history[0].role == "user"


def test_chat_request_schema_rejects_missing_query():
    with pytest.raises(ValidationError):
        ChatRequest()


def test_chat_request_schema_rejects_empty_query():
    with pytest.raises(ValidationError):
        ChatRequest(query="")


def test_chat_request_schema_rejects_invalid_role():
    with pytest.raises(ValidationError):
        ChatRequest(query="hi", history=[{"role": "system", "content": "x"}])


def test_chat_message_rejects_non_string_content():
    with pytest.raises(ValidationError):
        ChatMessage(role="user", content={"nested": "table-like object"})


# ── Defensive history filter ─────────────────────────────────────────────

def test_history_filter_passes_short_plain_text():
    history = [ChatMessage(role="user", content="how much does Apple Mart owe?")]
    filtered = filter_history(history)
    assert filtered == [{"role": "user", "content": "how much does Apple Mart owe?"}]


def test_history_filter_none_returns_empty_list():
    assert filter_history(None) == []


def test_history_filter_omits_markdown_table_content():
    table_like = (
        "| Rank | Customer | Outstanding Balance |\n"
        "|------|----------|----------------------|\n"
        "| 1 | Apple Mart | QAR 33,574.50 |"
    )
    history = [ChatMessage(role="assistant", content=table_like)]
    filtered = filter_history(history)
    assert filtered == [{"role": "assistant", "content": _OMITTED_NOTE}]


def test_history_filter_omits_overlong_content():
    long_text = "x" * 500  # no pipes, but exceeds the length threshold
    history = [ChatMessage(role="assistant", content=long_text)]
    filtered = filter_history(history)
    assert filtered == [{"role": "assistant", "content": _OMITTED_NOTE}]


def test_history_filter_preserves_role_and_order():
    history = [
        ChatMessage(role="user", content="short question one"),
        ChatMessage(role="assistant", content="short answer one"),
        ChatMessage(role="user", content="short question two"),
    ]
    filtered = filter_history(history)
    assert [m["role"] for m in filtered] == ["user", "assistant", "user"]
    assert [m["content"] for m in filtered] == [
        "short question one", "short answer one", "short question two",
    ]


# ── /chat wiring (route_query mocked — no live OpenAI/Odoo required) ────

def test_chat_endpoint_success_shape():
    canned = {"tool": "get_business_alerts", "parameters": {}, "result": "## Business Alerts\n..."}
    with patch("apps.api.main.route_query", return_value=canned) as mocked:
        resp = client.post("/chat", json={"query": "show business alerts"})
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "success": True,
        "tool": "get_business_alerts",
        "parameters": {},
        "result": "## Business Alerts\n...",
    }
    mocked.assert_called_once()
    called_query, called_history = mocked.call_args.args
    assert called_query == "show business alerts"
    assert called_history == []


def test_chat_endpoint_filters_history_before_calling_route_query():
    table_like = "| A | B |\n|---|---|\n| 1 | 2 |"
    canned = {"tool": "get_unpaid_invoices", "parameters": {}, "result": "ok"}
    with patch("apps.api.main.route_query", return_value=canned) as mocked:
        resp = client.post("/chat", json={
            "query": "show unpaid invoices too",
            "history": [{"role": "assistant", "content": table_like}],
        })
    assert resp.status_code == 200
    _, called_history = mocked.call_args.args
    assert called_history == [{"role": "assistant", "content": _OMITTED_NOTE}]


def test_chat_endpoint_handles_exception_without_stack_trace():
    with patch("apps.api.main.route_query", side_effect=RuntimeError("boom")):
        resp = client.post("/chat", json={"query": "anything"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is False
    assert body["tool"] is None
    assert "boom" not in body["result"]
    assert "Traceback" not in body["result"]


def test_chat_endpoint_logs_exception_server_side(caplog):
    """Phase 9 audit fix: a route_query() failure must still be visible to
    an operator via the server log, even though the client only ever sees a
    generic message (see the exception-handling test above)."""
    with caplog.at_level("ERROR", logger="apps.api"):
        with patch("apps.api.main.route_query", side_effect=RuntimeError("boom")):
            client.post("/chat", json={"query": "anything"})
    assert any("boom" in record.getMessage() or record.exc_text and "boom" in record.exc_text
               for record in caplog.records)


def test_chat_endpoint_rejects_missing_query():
    resp = client.post("/chat", json={})
    assert resp.status_code == 422  # FastAPI validation error, not a 500


# ── Request-size limits (Phase 9 audit: closes an unbounded-payload /
#    cost-abuse vector) ──────────────────────────────────────────────────

def test_chat_endpoint_rejects_oversized_query():
    resp = client.post("/chat", json={"query": "x" * 2001})
    assert resp.status_code == 422


def test_chat_endpoint_accepts_query_at_the_length_limit():
    canned = {"tool": None, "parameters": {}, "result": "ok"}
    with patch("apps.api.main.route_query", return_value=canned):
        resp = client.post("/chat", json={"query": "x" * 2000})
    assert resp.status_code == 200


def test_chat_request_schema_rejects_oversized_history_message():
    with pytest.raises(ValidationError):
        ChatMessage(role="user", content="x" * 5001)


def test_chat_request_schema_rejects_too_many_history_turns():
    with pytest.raises(ValidationError):
        ChatRequest(
            query="hi",
            history=[{"role": "user", "content": "x"} for _ in range(51)],
        )


# ── /chat rate limiting by call frequency (closes the gap Phase 9's size
#    limits deliberately left open — see main.py's comment) ────────────────

def test_chat_endpoint_allows_requests_under_the_limit():
    canned = {"tool": None, "parameters": {}, "result": "ok"}
    with patch("apps.api.main.route_query", return_value=canned):
        for _ in range(api_main._CHAT_RATE_LIMIT_MAX):
            resp = client.post("/chat", json={"query": "hi"})
            assert resp.status_code == 200


def test_chat_endpoint_blocks_requests_once_the_limit_is_reached():
    canned = {"tool": None, "parameters": {}, "result": "ok"}
    with patch("apps.api.main.route_query", return_value=canned):
        for _ in range(api_main._CHAT_RATE_LIMIT_MAX):
            client.post("/chat", json={"query": "hi"})
        resp = client.post("/chat", json={"query": "one too many"})
    assert resp.status_code == 429
    assert "too many requests" in resp.json()["detail"].lower()


def test_chat_endpoint_rate_limit_window_expires():
    canned = {"tool": None, "parameters": {}, "result": "ok"}
    with patch("apps.api.main.route_query", return_value=canned):
        for _ in range(api_main._CHAT_RATE_LIMIT_MAX):
            client.post("/chat", json={"query": "hi"})
        assert client.post("/chat", json={"query": "blocked"}).status_code == 429

        # Simulate the window having fully elapsed rather than sleeping in
        # a test — same approach as tests/login-rate-limit.test.ts.
        future = time.monotonic() + api_main._CHAT_RATE_LIMIT_WINDOW_SECONDS + 1
        with patch("time.monotonic", return_value=future):
            resp = client.post("/chat", json={"query": "allowed again"})
    assert resp.status_code == 200


# ── CORS configurability (Phase 9 follow-up: previously hardcoded) ────────

def test_cors_origins_default_to_localhost_3000():
    assert api_main._cors_origins == ["http://localhost:3000"]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
