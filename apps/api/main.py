"""FastAPI backend — a thin HTTP wrapper around the existing AI/business
logic. This file contains NO business logic, NO tool logic, and NO direct
Odoo access. Its only two responsibilities are:

    1. Translate HTTP requests into a call to route_query(query, history) —
       reused exactly as-is from src/agent/router.py.
    2. Defensively re-apply the same lightweight, text-only history rule
       app.py's _build_history() already enforces, so that even a naive
       client cannot leak a large tool-output table back into LLM context
       across turns (see docs/SAAS_MIGRATION_PLAN.md, Risks §9).

route_query, TOOL_REGISTRY, and everything they call are imported unchanged.
Nothing in src/ is modified or duplicated here beyond the small filter below.
"""

import logging
import os
import sys
import time
from pathlib import Path

# Mirror the project's existing test-file pattern (see tests/test_security.py)
# so `uvicorn apps.api.main:app` resolves `src` regardless of invocation CWD.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from src.agent.router import route_query
from src.agent.tool_registry import TOOL_REGISTRY

from apps.api.auth import AuthenticatedUser, require_auth
from apps.api.schemas import (
    ChatMessage, ChatRequest, ChatResponse, HealthResponse, ToolsResponse,
)

# A markdown table row has multiple pipe-delimited cells; a formatted tool
# result is also simply long. Either signal means "not a lightweight text
# turn" and gets collapsed to a short note, exactly like _build_history does
# for anything carrying a `tool` key in the Streamlit app.
_TABLE_LIKE_MIN_PIPES = 3
_MAX_HISTORY_CONTENT_CHARS = 300
_OMITTED_NOTE = "(Prior tool output omitted.)"

logger = logging.getLogger("apps.api")

app = FastAPI(title="Odoo BI API", version="1.0.0")

# CORS_ALLOWED_ORIGINS is a comma-separated list; defaults to the Next.js
# dev/Docker origin so local usage needs zero configuration. Made
# configurable (previously hardcoded) so a real deployment on an actual
# domain doesn't require a code change — see docs/API_CONTRACT.md.
_cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# Rate limiting for /chat, by call *frequency* — Phase 9's audit added a
# per-request *size* cap (schemas.py's max_length fields) but left
# frequency unbounded: an authenticated apps/web session (or, since
# apps/api has no auth of its own, literally anyone who can reach it) could
# call /chat as fast as the network allows, each call costing a real
# OpenAI request. Global, not per-caller, for the same reason the login
# limiter (apps/web/lib/login-rate-limit.ts) is global: this layer has no
# concept of "who is asking" to key on (see docs/API_CONTRACT.md). Known
# limitation, same as that one: in-memory and per-process — resets on
# restart, doesn't coordinate across multiple instances.
_CHAT_RATE_LIMIT_MAX = 30
_CHAT_RATE_LIMIT_WINDOW_SECONDS = 60.0
_chat_request_times: list[float] = []


def _is_chat_rate_limited(now: float | None = None) -> bool:
    now = time.monotonic() if now is None else now
    global _chat_request_times
    _chat_request_times = [t for t in _chat_request_times if now - t < _CHAT_RATE_LIMIT_WINDOW_SECONDS]
    return len(_chat_request_times) >= _CHAT_RATE_LIMIT_MAX


def _register_chat_request(now: float | None = None) -> None:
    _chat_request_times.append(time.monotonic() if now is None else now)


def _looks_like_tool_output(content: str) -> bool:
    return content.count("|") >= _TABLE_LIKE_MIN_PIPES or len(content) > _MAX_HISTORY_CONTENT_CHARS


def filter_history(history: list[ChatMessage] | None) -> list[dict]:
    """Defensive, server-side re-application of the lightweight history rule.

    Input may come from any client. Output is always a list of plain
    {"role", "content"} dicts with short, non-tabular text only — the exact
    shape route_query()/run_agent() already expect.
    """
    if not history:
        return []
    filtered: list[dict] = []
    for msg in history:
        content = _OMITTED_NOTE if _looks_like_tool_output(msg.content) else msg.content
        filtered.append({"role": msg.role, "content": content})
    return filtered


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    # Deliberately unauthenticated (Phase 10): Docker's own HEALTHCHECK
    # (apps/api/Dockerfile) and Compose's depends_on:condition:
    # service_healthy hit this endpoint directly from inside the
    # container, with no token and no way to obtain one — the standard,
    # widely-accepted exception for liveness/readiness probes. It reveals
    # no business data, just a static status string.
    return HealthResponse(status="ok", service="odoo-bi-api")


@app.get("/tools", response_model=ToolsResponse)
def list_tools(user: AuthenticatedUser = Depends(require_auth)) -> ToolsResponse:
    return ToolsResponse(count=len(TOOL_REGISTRY), tools=sorted(TOOL_REGISTRY.keys()))


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest, user: AuthenticatedUser = Depends(require_auth)) -> ChatResponse:
    if _is_chat_rate_limited():
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please wait a moment and try again.",
        )
    _register_chat_request()

    filtered_history = filter_history(request.history)
    try:
        response = route_query(request.query, filtered_history)
        return ChatResponse(
            success=True,
            tool=response.get("tool"),
            parameters=response.get("parameters") or {},
            result=response.get("result", ""),
        )
    except Exception:
        # No stack trace ever reaches the client — same principle as app.py's
        # own try/except around its route_query call site. The traceback
        # still goes to the server-side log, though (Phase 9 audit finding:
        # this used to fail completely silently — an operator had no way to
        # know route_query() was failing for every request short of a user
        # complaint).
        logger.exception(
            "route_query() failed for user=%r query=%r", user.user_id, request.query[:200]
        )
        return ChatResponse(
            success=False,
            tool=None,
            parameters={},
            result="Sorry, something went wrong processing that request. Please try again.",
        )
