"""Pydantic request/response models for the FastAPI backend.

These are pure data shapes — no business logic lives here. The API layer's
only job is to translate HTTP <-> the existing route_query() contract.
"""

from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """A single lightweight, text-only history turn.

    Deliberately has only `role` + `content` (no `tool`, no structured data)
    so the schema itself cannot carry a raw tool-output payload — only text.
    """

    role: Literal["user", "assistant"]
    # 5000 is generous for a text turn; content over 300 chars is collapsed
    # by filter_history() anyway (see main.py), but that filter runs *after*
    # Pydantic has already parsed/allocated the string — an unbounded field
    # would let a client force a large allocation per history entry before
    # that filtering ever happens. (Phase 9 audit finding.)
    content: str = Field(..., max_length=5000)


class ChatRequest(BaseModel):
    # Unbounded query length was an open abuse vector: nothing stopped a
    # client from sending a multi-MB "question," which would still reach
    # route_query()/OpenAI as-is (unlike history, query content is never
    # filtered/collapsed). 2000 chars is far beyond any real business
    # question. (Phase 9 audit finding.)
    query: str = Field(..., min_length=1, max_length=2000, description="The user's natural-language question.")
    # The frontend never sends more than MAX_HISTORY_TURNS (12) turns
    # (apps/web/lib/history.ts), but that wasn't enforced server-side — any
    # client could send an arbitrarily large array. 50 is a generous
    # backstop, not a behavior change for the real frontend.
    history: list[ChatMessage] | None = Field(
        default=None,
        max_length=50,
        description="Optional prior turns, lightweight text-only. Re-filtered "
                    "server-side regardless of what the client sends.",
    )


class ChatResponse(BaseModel):
    """Stable shape regardless of success/failure — same keys always present."""

    success: bool
    tool: str | None = None
    parameters: dict = {}
    result: str


class HealthResponse(BaseModel):
    status: str
    service: str


class ToolsResponse(BaseModel):
    count: int
    tools: list[str]
