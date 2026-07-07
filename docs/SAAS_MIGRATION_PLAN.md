# SaaS Migration Plan — Streamlit Prototype → Next.js + FastAPI

**Status:** Migration complete through Phase 8H (documentation
finalization). See §8 for the phase checklist, §11 for what each phase
actually shipped (including deviations from the plan below), and §12 for
the resulting architecture. Sections 1–7 below are preserved as originally
written, at the start of the migration (Phase 8A) — they're the plan, not
a live status; §11/§12 are the after-the-fact record.
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

- [x] **8A** — Discovery + this plan.
- [x] **8B** — FastAPI backend skeleton wrapping `route_query()`.
- [x] **8C** — Next.js frontend skeleton (shipped fully wired to `POST /chat`, ahead of the original 8C/8D split — see §11).
- [x] **8D** — Frontend/API stabilization and integration hardening (bounded history, consolidated error display, double-submit guards).
- [x] **8E** — Single-password personal access control (Auth.js credentials + JWT, server-side `/dashboard` guard).
- [x] **8F** — Conversation persistence (Prisma + SQLite, per-user CRUD, sidebar UI).
- [x] **8G** — `docker-compose.saas.yml` for the full new stack, alongside the untouched Streamlit compose path.
- [x] **8H** — Documentation finalization and migration wrap-up *(this phase — see §11–§12)*.

Note: this plan originally numbered the Docker Compose phase 8F and the
documentation phase 8G (see the original text preserved in §7). In
execution, conversation persistence turned out to need its own phase and
was inserted as 8F, pushing Docker Compose to 8G and documentation to 8H.
The scope described in each lettered phase below still matches what was
built under that letter at the time it ran; only the two trailing letters
shifted. See §11 for the full actual-vs-planned account.

Explicitly deferred beyond 8H: billing, multi-tenant, organizations/teams,
production auth beyond the single-password gate, admin dashboard, scheduled
jobs/reports, Redis, production cloud deployment. Full detail and reasoning
in `docs/NEXT_PHASES.md`.

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

## 10. Non-Goals (through Phase 8H)

Explicitly not implemented, still: Stripe/billing, subscription plans,
multiple organizations, multiple Odoo tenants, user roles, admin dashboard,
email/WhatsApp reports, scheduled jobs, Redis/queues, production cloud
deployment. (Database persistence for conversations *was* built — Phase
8F, see §11 — but only for `apps/web`'s own conversation history, never for
Odoo business data, and never as multi-tenant storage.) Sequencing and
risk detail for whatever comes next: `docs/NEXT_PHASES.md`.

---

## 11. Actual Implementation Summary (Phases 8B–8H)

What follows is a factual account of what each phase actually shipped,
written after the fact — a supplement to, not a replacement for, the
phase-by-phase reports each phase's commit message and conversation record
already contain in full detail.

### 8B — FastAPI backend

Shipped exactly as planned in §4, with one field-naming refinement made
in-the-moment rather than left as this document's earlier draft shape:
`/chat` takes `{query, history}` and returns `{success, tool, parameters,
result}` — not the `{message}` / `{answer, tool_used, success}` shapes
floated in early drafts of §4. `pytest` was added to
`requirements-api.txt` per the §1.5 recommendation, so
`python -m pytest apps/api/tests -v` works as every later phase's
validation step assumes.

### 8C/8D — Next.js frontend

**Deviation from §5's original phasing**: §5 planned 8C as a UI skeleton
with *no* live `/chat` wiring, deferring that to 8D. In execution, 8C's
own governing instructions required the frontend to call `/health`,
`/tools`, **and** `/chat` — so 8C shipped a fully wired chat UI, and 8D
became stabilization/hardening (bounded history, consolidated error
display, double-submit guards, expanded test coverage) rather than initial
wiring. Functionally nothing was skipped; the UI skeleton and the live
wiring simply landed in the same phase instead of two.

### 8E — Authentication

Built as §6 anticipated: single shared password via `APP_ACCESS_PASSWORD`,
no database. One refinement: §6 left open whether the check should be a
FastAPI endpoint or a Next.js-side mechanism; it landed entirely on the
Next.js side (Auth.js, JWT sessions, a Server Component guard —
`docs/AUTH_AND_PERSISTENCE.md`), so `apps/api` has zero knowledge of users
or sessions, keeping that service's stated scope (§1.7) intact. Also
discovered and worked around: Next.js 16 renamed Middleware to Proxy and
documents it as insufficient as a sole authorization layer — the
`/dashboard` guard is a server-side check in the page component itself
(`requireSession()`), not a `proxy.ts`.

### 8F — Conversation persistence (not in the original lettered plan)

**Addition, not a deviation**: §8's original checklist had no phase for
per-user conversation history — Docker Compose and documentation were
originally 8F and 8G. A dedicated persistence phase was inserted as 8F
once it became clear "SaaS" implied users' conversations should survive a
page reload. Built with Prisma 7 + SQLite (via a `libsql` driver adapter —
Prisma 7 requires an explicit adapter, a real API change from earlier
Prisma versions), scoped strictly to conversation bookkeeping
(`role`/`content`/`timestamp` only — no tool internals). Full detail:
`docs/AUTH_AND_PERSISTENCE.md`.

### 8G — Docker Compose (originally planned as 8F)

Built as §7 anticipated: `docker-compose.saas.yml` running `api` + `web`
alongside the untouched Streamlit path. One real bug was found and fixed
only by actually running the stack end-to-end (not caught by any unit
test, which mock `revalidatePath`): the dashboard's auto-create-first-
conversation logic called a Server Action that revalidates its own route
mid-render, which Next.js 16 forbids. Also required `AUTH_TRUST_HOST=true`
in the container specifically — Auth.js's automatic host-trust fallback
only applies when `NODE_ENV !== "production"`, true for local dev but not
for the container's `next start`. Full detail: `docs/DOCKER_SAAS_STACK.md`.

### 8H — Documentation (originally planned as 8G)

This phase. No code behavior changes beyond fixing stale UI copy on the
public landing page (`apps/web/app/page.tsx`) that had been left over from
before Phase 8E's login gate shipped.

---

## 12. Current Architecture (Post-Migration)

```
                          Browser
                             │
              ┌──────────────┴──────────────┐
              ▼                              ▼
     Streamlit UI (app.py)          Next.js UI (apps/web)
     — in-process call —            — login, conversation
              │                       history, chat UI —
              │                              │
              │                    POST /chat, GET /health,
              │                    GET /tools (browser → published
              │                    host port, see DOCKER_SAAS_STACK.md)
              │                              │
              │                              ▼
              │                    FastAPI (apps/api) — thin wrapper,
              │                    zero business logic of its own
              │                              │
              └──────────────┬───────────────┘
                              ▼
                    route_query()  [src/agent/router.py — UNCHANGED]
                              │
                              ▼
                    TOOL_REGISTRY  [src/agent/tool_registry.py — UNCHANGED]
                              │
                              ▼
                    src/tools/*  [UNCHANGED]
                              │
                              ▼
                    Odoo read-only gateway  [UNCHANGED]
                              │
                              ▼
                            Odoo
```

Two independent front doors, one unchanged core. Neither UI duplicates any
business/analytics logic; both ultimately call the identical
`route_query()`. `apps/web` additionally owns a concern `app.py` never had
— who's asking, and what did they say — via Auth.js (JWT sessions) and
Prisma/SQLite (per-user conversation history), both entirely separate from,
and unaware of, Odoo/business data. Full detail:
`docs/AUTH_AND_PERSISTENCE.md`, `docs/API_CONTRACT.md`,
`docs/DOCKER_SAAS_STACK.md`.

**What did not change, verified at every phase**: `src/`, `route_query()`,
the tool registry, every business tool, and the three-layer Odoo read-only
security model. Every phase's validation included `git diff --stat --
src/` (and later `app.py`, `apps/api/main.py`, `apps/api/schemas.py`)
staying empty, and `tests/test_security.py` passing unchanged.
