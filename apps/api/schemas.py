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
    content: str


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, description="The user's natural-language question.")
    history: list[ChatMessage] | None = Field(
        default=None,
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
