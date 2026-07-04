# Odoo BI Web — Next.js Frontend (Skeleton)

A Next.js UI for the Odoo Business Intelligence Assistant. Contains **no**
business logic, tool logic, or Odoo access of its own — every question is
sent to the FastAPI backend (`apps/api`), which is the only thing that talks
to `route_query()`.

See `docs/SAAS_MIGRATION_PLAN.md` for the full migration context. This phase
(8C) ships a working chat UI against the FastAPI backend; a real login gate,
full Docker Compose stack, and doc pass land in later phases (8E–8G).

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

## Tests

```bash
npm run test
```

Covers the lightweight-history function: plain text passes through
unchanged; a tool-backed turn is collapsed to a short note and never
leaks its markdown table/figures back into history; turn order is
preserved.

## Build

```bash
npm run build
```

## What this app does NOT do

- No business logic, no tool logic, no direct Odoo or OpenAI access.
- No database, no real authentication yet, no billing, no multi-tenancy.
- Does not affect the existing Streamlit app (`app.py`) in any way; both can
  run side by side, both ultimately call the same unchanged `route_query()`.
