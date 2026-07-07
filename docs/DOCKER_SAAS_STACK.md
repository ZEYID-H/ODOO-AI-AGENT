# Running the Full SaaS Stack Locally (Docker Compose)

**Phase 8G.** Runs the Next.js frontend, the FastAPI backend, and the
existing Python `src/` business logic together via Docker Compose, with
conversation persistence surviving container restarts. This is **local
development/testing tooling only** — production hosting is a later,
separate phase (see `docs/SAAS_MIGRATION_PLAN.md` §7).

The existing Streamlit app (`app.py`, `Dockerfile`, `docker-compose.yml`) is
untouched and keeps working independently — this is an additive stack, not
a replacement.

---

## Architecture

```
Browser (host machine)
  │
  ├──────────────► web container — Next.js (published :3000)
  │                   │  Prisma + SQLite/libsql → conversations-data volume
  │                   │  Auth.js login gate
  │                   │
  └──────────────► api container — FastAPI (published :8000)
                       │  imports route_query() from src/ — UNCHANGED
                       ▼
                     src/ business logic → mock data or live Odoo
```

Both containers share a Docker Compose network and can resolve each other
by service name (`api`, `web`) — used by `web`'s own startup readiness
check. **Browser-side chat/health calls still go through the API's
*published host port*, not that internal DNS name** — the browser runs on
the host, outside the compose network, so it can only ever reach containers
via ports mapped to `localhost`. See the comments in
`docker-compose.saas.yml` for the full explanation.

---

## Prerequisites

- Docker Desktop (or an equivalent Docker Engine + Compose v2) running.
- Two environment files, both git-ignored:

| File | Copy from | Contains |
|---|---|---|
| `.env` (repo root) | `.env.example` | `OPENAI_API_KEY`, `DATA_BACKEND`, `ODOO_*` — same variables the Streamlit app already uses |
| `apps/web/.env.docker` | `apps/web/.env.docker.example` | `AUTH_SECRET`, `APP_ACCESS_PASSWORD` |

Everything else (the SQLite path, the internal API URL, `AUTH_TRUST_HOST`)
is set directly in `docker-compose.saas.yml` — it isn't secret, so it's
tracked in git rather than duplicated across env files.

`DATA_BACKEND` defaults to `mock` if unset, so the stack runs fully offline
(no Odoo, no real ERP data) out of the box. Set `DATA_BACKEND=odoo` plus the
`ODOO_*` variables only once you've provisioned the dedicated read-only Odoo
user (see `docs/ODOO_READONLY_USER.md`).

---

## Build and run

```bash
docker compose -f docker-compose.saas.yml build
docker compose -f docker-compose.saas.yml up
```

- Web: **http://localhost:3000** (redirects to `/login`)
- API: **http://localhost:8000** (docs at `/docs`)

Log in with the password set in `apps/web/.env.docker`'s
`APP_ACCESS_PASSWORD`. A first conversation is auto-created on your first
dashboard visit.

Stop with `docker compose -f docker-compose.saas.yml down` (keeps the
conversation database). Add `-v` to also delete the volume and start fresh.

---

## Persistence

Conversations live in a named Docker volume (`conversations-data`), mounted
at `/data` in the `web` container, with `DATABASE_URL=file:/data/conversations.db`.
On every container start, `apps/web/docker-entrypoint.sh` runs
`prisma migrate deploy` against that path before the server starts —
idempotent, so restarts don't touch existing data, and a brand-new volume
gets the schema created automatically.

To verify persistence survives a restart:

```bash
# 1. Create a conversation and send a message via the UI at localhost:3000
docker compose -f docker-compose.saas.yml restart web
# 2. Reload localhost:3000 — the conversation and its messages are still there
```

---

## Environment variables reference

| Variable | Service | Set in | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | api | `.env` | Enables OpenAI function-calling routing (falls back to rule-based routing if unset) |
| `OPENAI_MODEL` | api | `.env` | Optional, defaults to `gpt-4o-mini` |
| `DATA_BACKEND` | api | `.env` | `mock` (default) or `odoo` |
| `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD`, `EXPECTED_ODOO_USER` | api | `.env` | Only needed when `DATA_BACKEND=odoo` |
| `NEXT_PUBLIC_API_BASE_URL` | web (build arg) | shell env or defaults to `http://localhost:8000` | Baked into the browser bundle — must be host-reachable, not a compose service name |
| `DATABASE_URL` | web | `docker-compose.saas.yml` | Points at the mounted volume: `file:/data/conversations.db` |
| `AUTH_TRUST_HOST` | web | `docker-compose.saas.yml` | Must be `true` in this container — Auth.js's automatic dev-mode host trust doesn't apply once `NODE_ENV=production` |
| `API_INTERNAL_URL` | web | `docker-compose.saas.yml` | `http://api:8000` — used only by the startup readiness wait in `docker-entrypoint.sh` |
| `AUTH_SECRET` | web | `apps/web/.env.docker` | Signs the session JWT cookie |
| `APP_ACCESS_PASSWORD` | web | `apps/web/.env.docker` | The single shared login password |

---

## Troubleshooting

- **`web` container loops waiting for the API**: check `docker compose -f
  docker-compose.saas.yml logs api` — usually a missing/invalid `.env` at
  the repo root.
- **Login fails with an "Untrusted host" style error**: confirm
  `AUTH_TRUST_HOST=true` is actually reaching the container (`docker
  compose -f docker-compose.saas.yml exec web env | grep AUTH_TRUST_HOST`).
- **Chat requests fail from the browser but `/health` works via curl from
  inside the `api` container**: `NEXT_PUBLIC_API_BASE_URL` was baked in at
  build time — rebuild `web` (`docker compose -f docker-compose.saas.yml
  build web`) after changing it, a plain restart won't pick up a new value.
