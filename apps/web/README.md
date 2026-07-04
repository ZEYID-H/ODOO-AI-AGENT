# Odoo BI Web — Next.js Frontend

A Next.js UI for the Odoo Business Intelligence Assistant. Contains **no**
business logic, tool logic, or Odoo access of its own — every question is
sent to the FastAPI backend (`apps/api`), which is the only thing that talks
to `route_query()`.

See `docs/SAAS_MIGRATION_PLAN.md` for the full migration context. Phase 8C
shipped a working chat UI against the FastAPI backend; Phase 8D hardened its
error handling, history bounds, and double-submit safety (see below). A real
login gate, full Docker Compose stack, and doc pass land in later phases
(8E–8G).

## Install

```bash
cd apps/web
npm install
```

## Configure

```bash
cp .env.local.example .env.local
```

`NEXT_PUBLIC_API_BASE_URL` must point at the running FastAPI backend
(default `http://localhost:8000`). It's `NEXT_PUBLIC_`-prefixed because it's
read in the browser, not just on the server.

## Run locally

In one terminal, start the backend (from the repo root):

```bash
pip install -r requirements-api.txt
uvicorn apps.api.main:app --reload
```

In another terminal, start the frontend:

```bash
cd apps/web
npm run dev
```

Open **http://localhost:3000**. `/` is a placeholder landing page (no real
auth yet); `/dashboard` is the chat interface.

## Pages

| Route | Purpose |
|---|---|
| `/` | Landing placeholder — links to `/dashboard`. No authentication yet (Phase 8E). |
| `/dashboard` | Sidebar + top bar + chat + quick-action cards, calling the FastAPI backend. |

## What it calls

- `GET /health` — on load, to show a connected/offline indicator.
- `GET /tools` — on load, to show the live tool count.
- `POST /chat` — on every question (typed or via a quick-action card).

`lib/api.ts` is the only file that talks to the network. `lib/history.ts`
keeps the conversation history sent back to the API lightweight and
text-only (mirrors `app.py`'s `_build_history`) — a full tool-output table
is never resent as "history," even though the backend also independently
re-filters it server-side.

## Hardening (Phase 8D)

- **History is bounded.** `buildLightweightHistory` caps the history sent per
  request to the most recent `MAX_HISTORY_TURNS` (12) turns, so a long
  session's payload/cost/latency don't grow unbounded — only recent turns are
  needed to resolve short-term references like "show unpaid invoices too."
- **Errors always render clearly, once.** Both a thrown `ApiError` (network
  down, malformed response) and a `{success: false}` response from `/chat`
  render as a single, visually distinct error bubble (`role="alert"`,
  red-tinted) inline in the conversation — no separate floating banner
  duplicating the same message.
- **`lib/api.ts` surfaces real error detail.** Non-OK responses try to parse
  FastAPI's `detail` field (string or validation-error list) for a readable
  message instead of just "failed (422)"; a response body that isn't valid
  JSON (on either the error or success path) is caught and wrapped in
  `ApiError` instead of throwing an unhandled `SyntaxError`.
- **Double-submit is prevented at the handler, not just the UI.** `handleAsk`
  guards on `if (loading || !trimmed) return` before doing anything, so a
  request can't be sent twice even if a click slips through before the
  `disabled` prop re-renders. Empty/whitespace-only messages are blocked the
  same way, independent of `ChatInput`'s own `.trim()` check.

## Tests

```bash
npm run test
```

| File | Covers |
|---|---|
| `tests/history.test.ts` | Lightweight-history building: plain text passes through unchanged; a tool-backed turn is collapsed to a short note and never leaks markdown/figures back into history; turn order preserved; history capped to the most recent `MAX_HISTORY_TURNS`. |
| `tests/api.test.ts` | API client success paths (`/health`, `/tools`, `/chat` request shape) and failure paths (network error, non-OK status with FastAPI `detail` parsing, non-JSON body on either success or error). |
| `tests/display.test.tsx` | `TopBar`/`Sidebar` render the correct connection/tool-count state for `checking`/`online`/`offline` and `null`/`14`; quick-question clicks call `onAsk` with the right question; buttons disable while a request is in flight. |
| `tests/DashboardPage.test.tsx` | Full page: loading state during a pending `/chat` call, empty/whitespace input blocked client-side, a rapid second click while a request is in-flight only calls `chat()` once, and both failure modes (thrown `ApiError`, `success: false`) render a single error bubble. |

## Build

```bash
npm run build
```

## What this app does NOT do

- No business logic, no tool logic, no direct Odoo or OpenAI access.
- No database, no real authentication yet, no billing, no multi-tenancy.
- Does not affect the existing Streamlit app (`app.py`) in any way; both can
  run side by side, both ultimately call the same unchanged `route_query()`.
