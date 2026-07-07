# API Contract — `apps/api` (FastAPI)

The canonical reference for the FastAPI backend's HTTP surface. This
service (`apps/api/main.py`) is a thin wrapper: every response is either a
static value (`/health`, `/tools`) or the direct result of calling
`route_query()` from `src/agent/router.py`, **unchanged**. No endpoint here
computes a business answer itself.

Base URL locally: `http://localhost:8000` (both `npm run dev` and the
Docker Compose stack). Interactive/generated docs: `GET /docs`
(Swagger UI, from FastAPI automatically).

---

## `GET /health`

Liveness probe. Used by: Docker's `HEALTHCHECK` (`apps/api/Dockerfile`),
`docker-compose.saas.yml`'s `depends_on: condition: service_healthy`,
`apps/web/docker-entrypoint.sh`'s internal-network readiness wait, and the
frontend's connection-status indicator (`lib/api.ts::getHealth`).

**Response `200`:**
```json
{"status": "ok", "service": "odoo-bi-api"}
```

No failure mode other than the process not running at all (connection
refused) — this endpoint does not touch `route_query()`, Odoo, or OpenAI.

---

## `GET /tools`

Lists the tools currently registered in `TOOL_REGISTRY`
(`src/agent/tool_registry.py`) — names and a count only, never a function
reference or anything callable. Used by the frontend's sidebar
("Tools available: N").

**Response `200`:**
```json
{
  "count": 14,
  "tools": [
    "get_business_alerts",
    "get_customer_balance",
    "get_customer_insights",
    "..."
  ]
}
```

`tools` is sorted alphabetically. This list is read directly off the
registry at request time — it can never drift from what `route_query()`
can actually route to, because both use the same `TOOL_REGISTRY` object.

---

## `POST /chat`

The one endpoint that does real work — everything else is bookkeeping
around this call.

**Request:**
```json
{
  "query": "how much does Apple Mart owe?",
  "history": [
    {"role": "user", "content": "show unpaid invoices"},
    {"role": "assistant", "content": "(Provided get_unpaid_invoices results.)"}
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `query` | `string` | Yes, `min_length=1`, `max_length=2000` | The user's natural-language question. Empty/missing/over-length → `422`. |
| `history` | `[{role, content}]` \| `null`, `max_length=50` | No | Lightweight, text-only prior turns. `role` must be `"user"` or `"assistant"` (Pydantic `Literal`); each `content` is capped at `max_length=5000` — anything invalid → `422`. |

The length caps (Phase 9 audit) close an unbounded-payload abuse vector:
before them, nothing stopped a client from sending an arbitrarily large
`query` straight through to OpenAI (unlike `history`, `query` content is
never collapsed/filtered — see below), or an arbitrarily long `history`
array/message forcing large allocations before `filter_history` ever runs.
None of the limits change behavior for the real frontend, which never
approaches them (`apps/web/lib/history.ts` caps history to
`MAX_HISTORY_TURNS` = 12 turns well under the 50-item server-side cap).

**`history` is always re-filtered server-side before reaching
`route_query()`**, regardless of what the client sends
(`apps/api/main.py::filter_history`): any turn whose content looks like
tool output (≥3 `|` characters, or longer than 300 characters) is replaced
with the literal string `"(Prior tool output omitted.)"`. This is
defense-in-depth — the frontend (`apps/web/lib/history.ts`) already applies
the equivalent rule before sending, but the API never trusts a client to
have done so. See [`AUTH_AND_PERSISTENCE.md`](AUTH_AND_PERSISTENCE.md) for
how this interacts with database-reloaded conversation history.

**Response `200`** — same shape whether `route_query()` succeeded or not:
```json
{
  "success": true,
  "tool": "get_customer_balance",
  "parameters": {"customer_name": "Apple Mart"},
  "result": "## Balance — Apple Mart\n..."
}
```

| Field | Type | Notes |
|---|---|---|
| `success` | `bool` | `false` only when `route_query()` raised an exception — never reflects a "no data found" business answer, which is still `success: true` with an explanatory `result`. |
| `tool` | `string \| null` | Which tool the router selected. `null` on failure, or when the router answered without calling a tool (e.g. a greeting). |
| `parameters` | `object` | The arguments the tool was called with (for display/debugging — the frontend shows this as "🔧 Tool called: X"). |
| `result` | `string` | Markdown. On failure: a short, static, friendly message — **never a stack trace or exception detail**. |

### Error behavior

- **Validation errors** (missing `query`, wrong `history` shape): FastAPI's
  standard `422` with a `detail` array. `lib/api.ts::describeErrorResponse`
  knows how to extract a readable message from this shape.
- **Any exception from `route_query()`** (OpenAI unreachable in a way the
  router's own fallback didn't absorb, an unexpected tool error, etc.): caught
  at the endpoint boundary, returned as HTTP `200` with
  `{"success": false, "tool": null, "parameters": {}, "result": "Sorry, something went wrong processing that request. Please try again."}`.
  This mirrors `app.py`'s own try/except around its `route_query()` call
  site — the two front ends fail identically. The exception itself is
  additionally logged server-side (`logging.getLogger("apps.api")`, Phase
  9 audit fix) — before this, a failing `route_query()` was completely
  invisible to an operator; nothing showed up anywhere except a user
  complaint. The client-facing response is unchanged either way.
- **Network-level failure** (API unreachable at all): the frontend never
  gets an HTTP response — `lib/api.ts` wraps the fetch failure in
  `ApiError("Could not reach the API. Is the backend running at ...")`.
- **Rate limited**: `429` with `{"detail": "Too many requests. Please wait
  a moment and try again."}` after 30 requests within a rolling 60-second
  window, enforced globally (see below). `lib/api.ts`'s existing `detail`
  parsing surfaces this message without any frontend changes.

---

## CORS

`apps/api/main.py` configures `CORSMiddleware` for the origins listed in
`CORS_ALLOWED_ORIGINS` (comma-separated env var, defaults to
`http://localhost:3000`) — `GET`/`POST` only, never wildcard-open. Made
configurable, rather than hardcoded, specifically so serving `apps/web`
from a different origin (a different port, a real domain) is a
configuration change, not a code change.

---

## Rate limiting on `/chat`

Global (not per-caller — this API has no concept of "who is asking," see
below), in-memory sliding window: max 30 requests per rolling 60 seconds.
Exceeding it returns `429` (see Error behavior above). This closes the
*frequency* gap deliberately left open when request *size* was bounded —
an authenticated `apps/web` session (or, since this API has no auth of its
own, literally anyone who can reach it) could otherwise call `/chat` as
fast as the network allows, each call costing a real OpenAI request.

**Known limitation, stated plainly**: this state is in-memory and
per-process — resets on restart, doesn't coordinate across multiple
instances. Same limitation, same reasoning, as `apps/web`'s login rate
limiter (`docs/AUTH_AND_PERSISTENCE.md`).

---

## Frontend expectations (what `apps/web` assumes)

- `lib/api.ts` is the **only** file in `apps/web` that calls this API — no
  component fetches these endpoints directly.
- `NEXT_PUBLIC_API_BASE_URL` must be a URL the **browser** can reach (these
  calls run client-side, from `"use client"` components), not a Docker
  Compose internal service name — see
  [`DOCKER_SAAS_STACK.md`](DOCKER_SAAS_STACK.md).
- The frontend never sends more than `MAX_HISTORY_TURNS` (12) turns, and
  always pre-filters tool-output-shaped content itself before sending —
  the API's own re-filtering is a second, independent layer, not the only
  one.
- A `success: false` response is rendered as a distinct, styled error
  bubble in the chat (`role="alert"`), not a thrown exception — the
  frontend treats it as "the assistant answered with an error," which is
  still a real conversation turn (see conversation-persistence behavior in
  [`AUTH_AND_PERSISTENCE.md`](AUTH_AND_PERSISTENCE.md)).

---

## What this service intentionally does not expose

- No endpoint executes a tool directly — only `route_query()`'s own
  tool-selection logic can do that (`apps/api` never imports
  `TOOL_REGISTRY[name]["function"]`).
- No endpoint touches Odoo directly, authentication, users, or
  conversations — those are `apps/web`'s responsibility (Auth.js, Prisma).
  This API has no concept of "who is asking."
- No pagination, rate limiting, or streaming (SSE/WebSocket) — every
  `/chat` call is a single synchronous request/response.
