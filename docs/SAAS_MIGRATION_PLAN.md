# SaaS Migration Plan — Streamlit Prototype → Next.js + FastAPI

**Status:** Phase 8A (discovery + plan). No code changed by this document.
**Principle throughout:** the existing Python business logic in `src/` is the
asset being protected, not replaced. Every later phase wraps it; none of them
rewrite it.

---

## 1. Discovery Findings

### 1.1 Current architecture

```
Browser
  │
  ▼
Streamlit UI (app.py)
  │  st.session_state.messages, _build_history(), quick-question buttons
  ▼
route_query(query, history)          [src/agent/router.py]
  │  OpenAI function-calling path, with deterministic rule-based fallback
  ▼
TOOL_REGISTRY[name] = {function, formatter}   [src/agent/tool_registry.py]
  │
  ▼
src/tools/*.py  (14 read-only business tools + formatters)
  │
  ▼
src/data/provider.py  (mock | odoo backend switch)
  │
  ▼
src/services/odoo_service.py  (the ONLY XML-RPC gateway)
  │  gated by src/services/odoo_security.py (enforce_read_only)
  │  validated at boot by src/services/odoo_config.py (validate_startup)
  ▼
Odoo  (search / search_read / read only)
```

### 1.2 The exact function Streamlit uses to ask the AI

`app.py` calls exactly one function to get an answer:

```python
from src.agent.router import route_query
response = route_query(user_input, history)
# response = {"tool": str, "parameters": dict, "result": str}
```

`route_query` (in `src/agent/router.py:183`) is the single, stable, public
entry point. It internally tries OpenAI function calling
(`src.services.openai_service.run_agent`) and falls back to deterministic
keyword routing on any failure — callers never see that branching; they
always get back `{tool, parameters, result}`.

**This is the one function the FastAPI backend needs to import and call.**
Nothing about it needs to change.

### 1.3 How history is built

`app.py::_build_history(messages)` converts the UI's full message log into a
lightweight, **text-only** list before it's sent to `route_query`:

```python
history = _build_history(st.session_state.messages[:-1])
response = route_query(user_input, history)
```

Rule enforced by `_build_history`: only `{"role": "user"|"assistant",
"content": str}` pairs are kept. A tool's markdown table is never stored —
only a short note (`"(Provided get_customer_balance results.)"`). This is
what guarantees ERP figures are always fetched fresh from a live tool call
and never "recalled" from stale conversation memory.

`route_query` → `run_agent` → `_build_messages` (in
`src/services/openai_service.py:85`) expects history in exactly that
`{"role", "content"}` shape and does nothing further to it. **The
lightweight-history contract is enforced by whoever builds `history` before
calling `route_query`** — today that's `app.py`; after migration it must
also be true of the FastAPI backend, for any client (Next.js today, anything
else tomorrow).

### 1.4 Environment variables required

| Variable | Required for | Notes |
|---|---|---|
| `OPENAI_API_KEY` | AI routing | Missing → automatic fallback to rule-based routing, no crash |
| `OPENAI_MODEL` | No (optional) | Defaults to `gpt-4o-mini` |
| `DATA_BACKEND` | No (optional) | `mock` (default) or `odoo` |
| `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD` | Live Odoo mode | `ODOO_USERNAME` must be the dedicated read-only account |
| `EXPECTED_ODOO_USER` | Live Odoo mode | Startup refuses to run if `ODOO_USERNAME` doesn't match |

All already documented in `.env.example` and `DEPLOYMENT.md`; unchanged by
this migration.

### 1.5 Current test commands

| Command | Covers |
|---|---|
| `python tests/test_provider.py` | Mock-mode data integrity |
| `python tests/test_security.py` | Read-only enforcement (10 checks) |
| `python tests/test_date_filters.py` | Natural-language date parser |
| `python test_routing.py` | End-to-end rule-based routing smoke test |
| `python tests/test_odoo_connection.py` | Manual live-Odoo read check (needs real creds) |

**Discovery finding — `pytest` is not currently installed** in this
project's venv (`python -m pytest` → `No module named pytest`). All five
test files are written to run standalone (`if __name__ == "__main__":`
blocks with their own pass/fail summary) specifically so no test runner
dependency is required. They are also pytest-*compatible* (function names
start with `test_`), so `pip install pytest` would make `python -m pytest`
work immediately with zero test-code changes — but that installation hasn't
happened yet. **Decision needed in Phase 8B:** either (a) add `pytest` to a
dev/API requirements file so `python -m pytest` works as the roadmap's
validation commands assume, or (b) keep validating via the existing
per-file commands above. Recommendation: (a) — it's a one-line addition and
makes the roadmap's stated validation commands actually work.

### 1.6 What can be reused directly in FastAPI

- `src.agent.router.route_query` — the entire AI/routing/tool-execution
  pipeline, unchanged, imported as-is.
- `src.agent.tool_registry.TOOL_REGISTRY` — for a `/tools` endpoint (`len()`
  and `.keys()` only; never call `["function"]` directly from the API layer
  — always go through `route_query`, never around it).
- Every `src/tools/*.py`, `src/data/provider.py`, `src/services/*.py` —
  reused transitively through `route_query`; the API layer never imports
  them directly.

### 1.7 What must remain untouched

- `src/services/odoo_security.py`, `odoo_config.py`, `odoo_service.py` — the
  three-layer read-only enforcement. The API layer must never call Odoo
  directly; it only ever calls `route_query`.
- `src/agent/tool_registry.py`, `tool_schemas.py` — tool wiring.
- All `src/tools/*.py` — business calculations.
- `tests/*`, `test_routing.py` — existing regression coverage.
- `app.py` — the Streamlit prototype keeps running exactly as it does today,
  side by side with the new stack, for as long as both are useful.

---

## 2. Target Architecture

```
Browser
  │
  ▼
Next.js UI (apps/web)              — chat, dashboard, quick actions
  │  fetch(NEXT_PUBLIC_API_BASE_URL + "/chat", ...)
  ▼
FastAPI (apps/api)                 — thin HTTP wrapper, no business logic
  │  imports route_query() directly, unchanged
  ▼
route_query()                      [src/agent/router.py — UNCHANGED]
  │
  ▼
TOOL_REGISTRY                      [src/agent/tool_registry.py — UNCHANGED]
  │
  ▼
src/tools/*                       [UNCHANGED]
  │
  ▼
Odoo read-only gateway             [UNCHANGED]
  │
  ▼
Odoo
```

Two front doors exist during the migration: `app.py` (Streamlit, unchanged)
and `apps/web` (Next.js, new) both eventually talk to the same
`route_query()` — the Streamlit app in-process, the Next.js app via the new
FastAPI HTTP layer. Neither duplicates business logic.

---

## 3. Folder Plan

```
odoo-ai-agent/
├── app.py                      # Streamlit prototype — kept, unchanged
├── src/                        # existing business logic — kept, unchanged
├── tests/, test_routing.py     # existing tests — kept, unchanged
├── docs/
│   └── SAAS_MIGRATION_PLAN.md  # this file
│
├── apps/                       # NEW
│   ├── api/                    # FastAPI backend (Phase 8B)
│   │   ├── __init__.py
│   │   ├── main.py             # app + routes (/health, /tools, /chat)
│   │   ├── schemas.py          # Pydantic request/response models
│   │   └── README.md
│   │
│   └── web/                    # Next.js frontend (Phase 8C/8D)
│       ├── app/                # App Router pages
│       ├── components/
│       ├── lib/                # API client
│       └── ...standard Next.js project files
│
├── requirements-api.txt        # FastAPI + uvicorn (separate from requirements.txt)
├── docker-compose.yml          # existing Streamlit path — kept
└── docker-compose.saas.yml     # NEW (Phase 8F): api + web services
```

No existing file moves. `apps/` is purely additive.

---

## 4. API Endpoint Plan (Phase 8B)

| Method | Path | Purpose | Reuses |
|---|---|---|---|
| `GET` | `/health` | Liveness check: `{"status": "ok", "service": "odoo-bi-api"}` | — |
| `GET` | `/tools` | Tool inventory: count + names from `TOOL_REGISTRY` | `TOOL_REGISTRY` |
| `POST` | `/chat` | `{"message": str, "history": [{"role","content"}]}` → `{"answer": str, "tool_used": str\|None, "success": bool}` | `route_query()` |

`/chat` error handling: any exception from `route_query` is caught at the API
boundary and returned as `{"success": false, "answer": "<friendly message>",
"tool_used": null}` — never a raw traceback in the HTTP response (mirrors the
same principle already in `app.py`'s try/except around its call site).

---

## 5. Frontend Page Plan (Phase 8C/8D)

Visual reference: Stitch project **"Odoo Insight Copilot"**
(`projects/1999165054501836285`), screens: AI Assistant Home, Executive
Dashboard, Customer Insights, Business Alerts — all dark mode, matching the
theme already applied to the Streamlit prototype (`assets/streamlit_theme.css`).

| Route | Purpose | Phase |
|---|---|---|
| `/` | Landing / login placeholder | 8C (skeleton), 8E (real gate) |
| `/dashboard` | Main app shell: sidebar, top bar, chat input, quick-action cards, response card | 8C (skeleton), 8D (wired to API) |

UI skeleton in 8C ships with no live data except an optional `/health` ping;
8D wires the chat input and quick-action buttons to `POST /chat`.

---

## 6. Auth Plan (for Phase 8E — not implemented now)

Simplest safe option for personal/internal use, no database:

- Single shared password via `APP_ACCESS_PASSWORD` env var.
- Next.js login screen posts the password to a small check (either a
  dedicated `/auth` endpoint on the FastAPI side, or a Next.js server
  action/route handler) that compares it server-side and sets an
  http-only session cookie.
- `/dashboard` (and the API's `/chat`, `/tools`) reject requests without a
  valid session/cookie once this phase lands.
- No user table, no OAuth, no multi-tenant — explicitly out of scope per the
  hard rules, deferred to a genuinely later phase.

## 7. Deployment Plan (for later phases — not implemented now)

- Existing Streamlit Docker path (`Dockerfile`, `docker-compose.yml`) stays
  as-is — it remains a valid, independent deployment target.
- New `docker-compose.saas.yml` (Phase 8F) runs `api` + `web` as two
  services, each with its own lightweight Dockerfile, for local full-stack
  testing.
- Production hosting for the SaaS stack (Vercel for `apps/web`, a container
  host for `apps/api`) is explicitly a **later** phase, not covered by 8A–8G.

---

## 8. Phase Checklist

- [ ] **8A** — Discovery + this plan. *(current phase)*
- [ ] **8B** — FastAPI backend skeleton wrapping `route_query()`.
- [ ] **8C** — Next.js frontend skeleton (no live API calls except optional health check).
- [ ] **8D** — Connect Next.js chat + quick actions to `POST /chat`.
- [ ] **8E** — Single-password personal access control (frontend + API gate).
- [ ] **8F** — `docker-compose.saas.yml` for the full new stack, alongside the untouched Streamlit compose path.
- [ ] **8G** — Documentation update (`README.md`, `DEPLOYMENT.md`, this plan) reflecting the shipped SaaS stack.

Explicitly deferred beyond 8G: billing, multi-tenant, organizations/teams,
production auth beyond the single-password gate, admin dashboard, scheduled
jobs/reports, database persistence, Redis, production cloud deployment.

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| API layer accidentally bypasses `route_query` and calls a tool or Odoo directly | Code review rule: `apps/api` may only import `route_query` and `TOOL_REGISTRY` (for listing names, not executing). Enforced by the "reuse, don't duplicate" rule in every phase's report. |
| A naive Next.js client sends full tool-output tables back as "history," leaking ERP data into repeated LLM context | FastAPI's `/chat` re-applies the same lightweight text-only history filter `_build_history` already enforces (small duplicated pure function inside `apps/api`, not a `src/` change) before calling `route_query`. |
| `pytest` absent means the roadmap's stated `python -m pytest` validation step fails out of the box | Flagged above (§1.5); Phase 8B adds `pytest` to a dev/API requirements file so the stated commands work as written. |
| Two front doors (Streamlit + Next.js) drift out of sync in capability | Both call the identical `route_query()`; no tool/analytics logic is ever duplicated in either UI layer, so drift can only be cosmetic, not functional. |
| CORS between `apps/web` (likely `localhost:3000`) and `apps/api` (likely `localhost:8000`) | FastAPI's CORS middleware configured explicitly for the known frontend origin(s) in Phase 8B; not left wildcard-open. |
| Secrets duplicated across `.env` (Streamlit) and a new `apps/api/.env` | Single `.env` at repo root remains the source of truth; FastAPI reads the same env vars via the same mechanism (`python-dotenv` / process env), documented in `apps/api/README.md`. No new secret files. |
| Read-only guarantee accidentally weakened by the new layer | Nothing new touches Odoo. `apps/api` has zero imports from `src/services/odoo_*` or `src/data/provider.py`. Verified per-phase via `git diff --stat -- src/` (must stay empty) and by re-running `tests/test_security.py` unchanged. |
| Phase creep — frontend/backend/auth/deployment changes mixed into one commit | Enforced structurally: each phase's "Allowed new files" list is small and explicit; this plan itself is the only Phase 8A deliverable. |

---

## 10. Non-Goals (through Phase 8G)

Explicitly not implemented until a later, separate phase: Stripe/billing,
subscription plans, multiple organizations, multiple Odoo tenants, user
roles, admin dashboard, email/WhatsApp reports, scheduled jobs, database
persistence, Redis/queues, production cloud deployment.
