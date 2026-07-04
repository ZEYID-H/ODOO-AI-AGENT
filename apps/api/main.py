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

import sys
from pathlib import Path

# Mirror the project's existing test-file pattern (see tests/test_security.py)
# so `uvicorn apps.api.main:app` resolves `src` regardless of invocation CWD.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.agent.router import route_query
from src.agent.tool_registry import TOOL_REGISTRY

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

app = FastAPI(title="Odoo BI API", version="1.0.0")

# Forward-compatible with the Next.js dev server (Phase 8C/8D); no frontend
# exists yet, but CORS is configured explicitly rather than left wildcard-open.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


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
    return HealthResponse(status="ok", service="odoo-bi-api")


@app.get("/tools", response_model=ToolsResponse)
def list_tools() -> ToolsResponse:
    return ToolsResponse(count=len(TOOL_REGISTRY), tools=sorted(TOOL_REGISTRY.keys()))


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
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
        # own try/except around its route_query call site.
        return ChatResponse(
            success=False,
            tool=None,
            parameters={},
            result="Sorry, something went wrong processing that request. Please try again.",
        )
