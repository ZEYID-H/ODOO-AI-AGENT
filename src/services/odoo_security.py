"""Read-only security guard for all Odoo XML-RPC access.

This module is the single technical guarantee that the AI agent is an ERP
ANALYST, not an ERP OPERATOR. Every Odoo call must pass through
`enforce_read_only()` before any RPC leaves the process.

Defense in depth:
    L1  Odoo user `AI_AGENT_READONLY` has no write ACLs (see docs).
    L2  This whitelist rejects every non-read method (create/write/unlink/...).
    L3  READ_ONLY_MODE is canonical True; the app refuses to start otherwise.
    L4  Every decision (ALLOWED/BLOCKED) is written to an audit log.

Even if the LLM hallucinates, emits a bad tool call, or is prompt-injected, it
cannot reach a write method: the model never selects Odoo methods, and this gate
blocks anything outside {search, search_read, read} by exclusion.
"""

import os
import uuid
import logging
from pathlib import Path
from datetime import datetime


class SecurityException(Exception):
    """Raised when a non-read Odoo operation is attempted."""


# ── Layer 3: Read-only mode ──────────────────────────────────────────────────
# Canonical and non-negotiable. Flipping this to False makes the module raise on
# import (see assert_read_only_mode() at the bottom), so the app cannot start in
# a writable configuration.
READ_ONLY_MODE = True

# ── Layer 2: Method whitelist ────────────────────────────────────────────────
# The ONLY Odoo methods the agent may ever call. Everything else — create, write,
# unlink, copy, action_post, action_confirm, button_validate, reconcile, ... — is
# rejected by exclusion, including methods we have not anticipated.
ALLOWED_METHODS = frozenset({"search", "search_read", "read"})


# ── Layer 4: Audit logging ───────────────────────────────────────────────────
_AUDIT_LOG_PATH = Path(__file__).resolve().parents[2] / "security_audit.log"

# One id per process/session, for correlating all requests in an investigation.
SESSION_ID = uuid.uuid4().hex[:12]


def _current_user() -> str:
    """The acting Odoo user (the read-only service account). 'unknown' if unset."""
    return os.getenv("ODOO_USERNAME", "unknown")


def _build_audit_logger() -> logging.Logger:
    logger = logging.getLogger("odoo_audit")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    # Guard against duplicate handlers when the module is re-imported.
    if not any(isinstance(h, logging.FileHandler) for h in logger.handlers):
        handler = logging.FileHandler(_AUDIT_LOG_PATH, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    return logger


_audit_logger = _build_audit_logger()


def _audit(model: str, method: str, params, allowed: bool) -> None:
    decision = "ALLOWED" if allowed else "BLOCKED"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    user = _current_user()
    # Truncate params so the log stays readable and never dumps huge payloads.
    params_repr = repr(params)
    if len(params_repr) > 300:
        params_repr = params_repr[:300] + "...(truncated)"
    _audit_logger.info(
        f"[{timestamp}] user={user} session={SESSION_ID} "
        f"{model}.{method} {decision} params={params_repr}"
    )


def assert_read_only_mode() -> None:
    """Refuse to operate unless READ_ONLY_MODE is exactly True (Layer 3)."""
    if READ_ONLY_MODE is not True:
        raise SecurityException(
            "READ_ONLY_MODE must be True. Refusing to start in a writable configuration."
        )


def enforce_read_only(model: str, method: str, params=None) -> None:
    """Gate every Odoo call. Returns silently for reads; raises for writes.

    Raises:
        SecurityException: if read-only mode is disabled, or `method` is not in
        the {search, search_read, read} whitelist.
    """
    assert_read_only_mode()

    if method in ALLOWED_METHODS:
        _audit(model, method, params, allowed=True)
        return

    _audit(model, method, params, allowed=False)
    raise SecurityException(
        f"Blocked non-read method '{method}' on model '{model}'. "
        f"The AI agent is strictly read-only (allowed: {sorted(ALLOWED_METHODS)})."
    )


# Enforce Layer 3 at import time: importing this module in a writable
# configuration fails immediately, so nothing downstream can run.
assert_read_only_mode()
