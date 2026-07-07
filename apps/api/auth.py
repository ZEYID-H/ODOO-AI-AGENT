"""JWT verification for requests from apps/web — the trust boundary
between the two services (Phase 10).

Kept entirely separate from AI/business logic: this module only ever
answers "who is this, and is their token genuinely valid?" It never
touches route_query(), TOOL_REGISTRY, or any tool, and its verdict (an
AuthenticatedUser or a 401) is the only thing route handlers see — the
verified user id is never threaded into route_query() itself, which keeps
that function's signature and behavior completely unchanged.

apps/web signs a short-lived token after checking its own Auth.js session
(see apps/web/lib/api-token.ts) and attaches it as an Authorization: Bearer
header (apps/web/lib/api.ts). This module's only job is to verify that
signature and reject anything it didn't produce, anything expired, or
anything malformed — the backend must never blindly trust a caller just
because it can reach the network (see docs/API_AUTHENTICATION.md for the
full design: algorithm, lifetime, key management, rotation strategy).
"""

import os
from dataclasses import dataclass

import jwt
from fastapi import Header, HTTPException

_ALGORITHM = "HS256"
_ISSUER = "odoo-ai-agent-web"
_AUDIENCE = "odoo-ai-agent-api"


@dataclass(frozen=True)
class AuthenticatedUser:
    """The verified identity of the caller — only ever constructed after a
    signature (and expiry, issuer, audience) check has passed. `user_id`
    today is always Auth.js's single synthetic "personal-user" account
    (see apps/web/lib/auth-credentials.ts), but it's a real field, not
    discarded, so a future multi-user/organization claim is additive —
    nothing here assumes there's only ever one possible value."""

    user_id: str


def _get_secret() -> str | None:
    # Read fresh on every call rather than caching at import time: keeps
    # this testable (tests can set/change the env var per-case without
    # needing to reload the module) and matches how CORS_ALLOWED_ORIGINS
    # is handled — though that one *is* read once at import in main.py,
    # since it only feeds static middleware config, not a per-request
    # security decision.
    return os.getenv("API_AUTH_SECRET")


def _unauthorized(message: str) -> HTTPException:
    return HTTPException(
        status_code=401,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_auth(authorization: str | None = Header(default=None)) -> AuthenticatedUser:
    """FastAPI dependency — add to any route that must only run for a
    verified caller, e.g. `def chat(request: ChatRequest, user:
    AuthenticatedUser = Depends(require_auth))`.

    Every failure mode returns 401 (never 500 on bad input, never a stack
    trace, never echoes the offending token back) with a short, specific
    reason: missing header, wrong scheme, expired, bad signature,
    unparseable, or a token that's structurally valid but missing the
    claims we require.
    """
    if not authorization:
        raise _unauthorized("Missing authentication token")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized("Malformed authentication token")

    secret = _get_secret()
    if not secret:
        # Fails closed: an unconfigured secret must never be treated as
        # "accept everything" — same fail-closed principle as
        # verifyAppPassword on the apps/web side.
        raise _unauthorized("Authentication is not configured")

    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=[_ALGORITHM],
            audience=_AUDIENCE,
            issuer=_ISSUER,
        )
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Authentication token has expired")
    except jwt.InvalidSignatureError:
        raise _unauthorized("Invalid authentication token")
    except jwt.DecodeError:
        raise _unauthorized("Malformed authentication token")
    except jwt.InvalidTokenError:
        # Catches everything else structurally-valid-but-wrong: bad
        # audience, bad issuer, not-yet-valid (nbf), etc.
        raise _unauthorized("Invalid authentication token")

    user_id = payload.get("sub")
    if not user_id or not isinstance(user_id, str):
        raise _unauthorized("Invalid authentication token")

    return AuthenticatedUser(user_id=user_id)
