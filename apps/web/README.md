# Odoo BI Web — Next.js Frontend

A Next.js UI for the Odoo Business Intelligence Assistant. Contains **no**
business logic, tool logic, or Odoo access of its own — every question is
sent to the FastAPI backend (`apps/api`), which is the only thing that talks
to `route_query()`.

See `docs/SAAS_MIGRATION_PLAN.md` for the full migration history. Phase 8C
shipped a working chat UI against the FastAPI backend; Phase 8D hardened its
error handling, history bounds, and double-submit safety; Phase 8E added a
personal-access login gate (see below); Phase 8F added per-user conversation
persistence (see below); Phase 8G added the full Docker Compose stack
(`docker-compose.saas.yml`, `docs/DOCKER_SAAS_STACK.md`).

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

See the "Authentication" section below for `AUTH_SECRET` and
`APP_ACCESS_PASSWORD`, which are also required.

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

Open **http://localhost:3000**. `/` is a public landing page; `/dashboard`
requires signing in at `/login` first.

## Pages

| Route | Purpose |
|---|---|
| `/` | Public landing page — no auth required. Links to `/dashboard`. |
| `/login` | Password form. Already-authenticated visitors are redirected straight to `/dashboard`. |
| `/dashboard` | **Protected.** Sidebar + top bar + chat + quick-action cards, calling the FastAPI backend. Unauthenticated requests never receive this page's markup — see Authentication below. |

## Authentication (Phase 8E)

A minimal, database-free login gate for personal/internal use — one shared
password, no user table, no OAuth.

**Approach:** [Auth.js (NextAuth v5)](https://authjs.dev) with a
`Credentials` provider and JWT session strategy (no database adapter is
configured, so no database is required or used). Session state lives only in
a signed, http-only cookie — never in `localStorage`, never readable by
client-side JavaScript.

**Where the actual protection lives:** `app/dashboard/page.tsx` is a Server
Component that calls `requireSession()` (`lib/session-guard.ts`) *before*
rendering anything. If there's no valid session, it `redirect()`s to
`/login` server-side — an unauthenticated request never receives the
dashboard's HTML at all (verified with a plain `curl` request, no
JavaScript, no cookies: a bare 307 to `/login`). This is deliberately **not**
implemented as a `proxy.ts` (Next 16's renamed Middleware): Next's own
authentication guide explicitly documents Proxy as insufficient as a sole
authorization layer, recommending only "optimistic" checks there — real
protection belongs in a server-side check as close to the protected content
as possible, which is what `requireSession()` is.

**Required environment variables** (`.env.local`, never committed):

| Variable | Purpose |
|---|---|
| `AUTH_SECRET` | Signs/encrypts the session JWT. Generate with `npx auth secret` or `openssl rand -base64 33`. |
| `APP_ACCESS_PASSWORD` | The single shared password. If unset, login always fails (fails closed, not open). |

**Flow:**
- `/login` — a form (`components/LoginForm.tsx`) posts to a Server Action
  (`app/actions/auth.ts::loginAction`) that calls Auth.js's `signIn()`. A
  wrong password returns a generic "Invalid password. Please try again." —
  it never reveals whether the env var is missing vs. the password is wrong.
- **Logout** — the Sidebar's "🚪 Log Out" button posts to `logoutAction()`,
  which calls Auth.js's `signOut()` and clears the session cookie.
- **Redirect behavior** — unauthenticated → `/dashboard` redirects to
  `/login`; authenticated → `/login` redirects to `/dashboard`; `/` is
  always public regardless of auth state.

**Extending later:** this is deliberately built so none of the pieces below
require touching `route_query()`, the chat UI, or the dashboard guard itself:
- **Real users:** replace `lib/auth-credentials.ts`'s single-password check
  with a real user lookup (the `authorize()` callback in `auth.ts` already
  returns a `User` object — swap the source, not the wiring).
- **Organizations / roles / multi-tenant Odoo:** add fields to the JWT via
  Auth.js's `jwt`/`session` callbacks in `auth.ts`; `requireSession()` already
  returns the full `Session` object to callers.
- **Billing:** entirely orthogonal — gate specific actions/routes on
  `session.user` fields once they exist, same pattern as the auth check
  itself.

## Conversation persistence (Phase 8F)

Each authenticated user's conversations are stored in SQLite via Prisma —
sidebar list, New Chat / rename / delete / switch, auto-created first
conversation, full CRUD in `app/actions/conversations.ts`. Only
`role`/`content`/`timestamp` per message is ever persisted; no tool
internals. Ownership is enforced server-side on every read/write — a
conversation ID belonging to another user is indistinguishable from one
that doesn't exist. Full detail, schema, and what's intentionally not
built (real multi-user accounts, Postgres, rate limiting):
`docs/AUTH_AND_PERSISTENCE.md`.

## What it calls

- `GET /health` — on load, to show a connected/offline indicator.
- `GET /tools` — on load, to show the live tool count.
- `POST /chat` — on every question (typed or via a quick-action card).

`lib/api.ts` is the only file that talks to the FastAPI backend over HTTP
(see `docs/API_CONTRACT.md` for the full contract). `lib/history.ts` keeps
the conversation history sent back to the API lightweight and text-only
(mirrors `app.py`'s `_build_history`) — a full tool-output table is never
resent as "history," whether the turn just arrived from `/chat` or was
reloaded from the conversation database, even though the backend also
independently re-filters it server-side.

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
| `tests/DashboardClient.test.tsx` | The chat UI itself: loading state during a pending `/chat` call, empty/whitespace input blocked client-side, a rapid second click while a request is in-flight only calls `chat()` once, and both failure modes (thrown `ApiError`, `success: false`) render a single error bubble. |
| `tests/auth-credentials.test.ts` | The password-check logic in isolation: correct password succeeds, wrong password fails, and — critically — an unconfigured `APP_ACCESS_PASSWORD` fails closed (never accepts anything) rather than failing open. |
| `tests/session-guard.test.ts` | `requireSession()`: redirects to `/login` when there's no session, does not redirect when there is one. |
| `tests/LoginForm.test.tsx` | The login form renders a real `type="password"` field; an invalid-credentials response shows a clear error without echoing the submitted password; the submit button shows a pending state and re-enables after the request settles. |
| `tests/conversations.test.ts` | Conversation/message CRUD against a real, isolated test SQLite database: create/list/load/rename/delete, message persistence (only `role`/`content`/`timestamp` saved), and ownership enforcement — a second user can't read, rename, delete, or append to the first user's conversations, and never sees them listed. |

`tests/DashboardClient.test.tsx` and `tests/display.test.tsx` also cover
the conversation-list UI (switching, New Chat, rename, delete, and that a
persisted conversation's history renders on load) — see those files for
the full case list.

Not covered by `npm run test` (jsdom/RTL can't exercise async Server
Components, real HTTP cookies, or a real Prisma-backed server render) but
verified live instead: a plain `curl` to `/dashboard` with no auth returns
a genuine redirect to `/login` (proving server-side, not client-side,
protection); a full browser pass (headless Chromium, Phase 8E) confirmed
wrong-password → error, correct password → dashboard renders, visiting
`/login` while authenticated → redirected to `/dashboard`, and logout →
`/dashboard` becomes protected again; and, running the actual Docker image
(Phase 8G), a real cookie-based Auth.js login followed by an authenticated
dashboard load, plus conversation/message persistence surviving a
container restart, verified end-to-end via `curl` and direct database
inspection (`docs/DOCKER_SAAS_STACK.md`).

## Build

```bash
npm run build
```

## What this app does NOT do

- No business logic, no tool logic, no direct Odoo or OpenAI access.
- No real user accounts (Auth.js session is JWT-based; the one database
  that exists — SQLite via Prisma — stores conversation history only,
  scoped to the single shared-password account; see
  `docs/AUTH_AND_PERSISTENCE.md`), no billing, no organizations/multi-tenancy,
  no user roles yet.
- Does not affect the existing Streamlit app (`app.py`) in any way; both can
  run side by side, both ultimately call the same unchanged `route_query()`.
