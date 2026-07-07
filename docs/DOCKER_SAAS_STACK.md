# Running the Full SaaS Stack Locally (Docker Compose)

**Built in Phase 8G, clarified in 8H, hardened in Phase 9.** Runs the
Next.js frontend, the FastAPI backend, and the existing Python `src/`
business logic together via Docker Compose, with conversation persistence
surviving container restarts. This is **local development/testing tooling
only** — production hosting is a later, separate phase (see
`docs/NEXT_PHASES.md` and `docs/SAAS_MIGRATION_PLAN.md` §7).

The existing Streamlit app (`app.py`, `docker-compose.yml`) is untouched
and keeps working independently — this is an additive stack, not a
replacement. Its `Dockerfile` did pick up the same non-root-user hardening
described below (Phase 9 audit), since the underlying finding — every
Dockerfile in this repo ran as root — applied there too; nothing about
`app.py`'s own code changed.

Related docs: [`API_CONTRACT.md`](API_CONTRACT.md) (what `apps/api`
exposes), [`AUTH_AND_PERSISTENCE.md`](AUTH_AND_PERSISTENCE.md) (login +
conversation storage detail).

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

## Startup flow

What actually happens between `docker compose up` and the stack being
usable, in order:

1. **`api` starts** — `uvicorn apps.api.main:app`. Its `HEALTHCHECK`
   (`apps/api/Dockerfile`) polls `GET /health` until it passes.
2. **`web` waits on `api`** twice, independently:
   - `docker-compose.saas.yml`'s `depends_on: api: condition:
     service_healthy` — Compose itself won't start the `web` container
     until `api`'s healthcheck passes.
   - `web`'s own `docker-entrypoint.sh` *additionally* polls
     `http://api:8000/health` over the internal Docker network before
     doing anything else — belt-and-suspenders, and doubles as the
     concrete proof that internal service-name networking works (see
     Architecture above).
3. **`web`'s entrypoint runs `prisma migrate deploy`** against
   `DATABASE_URL` (the mounted volume) — idempotent, so this is safe and
   fast on every restart, not just the first one.
4. **`web` starts** (`next start`) and becomes reachable at
   `localhost:3000`.

If step 2 or 3 fails or hangs, `web`'s logs
(`docker compose -f docker-compose.saas.yml logs web`) will show exactly
which one — see Troubleshooting below.

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

## Image security and size (Phase 9 audit)

**Non-root**: both containers now run as a non-root user — `appuser`
(`api`, created explicitly) and `node` (`web`, reused from the
`node:20-slim` base image's own built-in user). Neither Dockerfile had a
`USER` directive before this; running as root inside a container widens
the blast radius if the container is ever compromised. Verified live:
`docker compose -f docker-compose.saas.yml exec api whoami` → `appuser`,
same for `web` → `node`; the full login/dashboard/persistence flow was
re-verified end-to-end afterward to confirm nothing broke (in particular,
`prisma migrate deploy` writing to the `/data` volume, and
`odoo_security.py`'s audit log being creatable under `DATA_BACKEND=odoo`).

If you extend either Dockerfile: avoid `chown -R` over a large `COPY`'d
tree (e.g. `node_modules`) in a layer *after* the `COPY` — this was tried
first here and measured to nearly **double** the `web` image size (2.02GB
→ 3.17GB), because a recursive ownership change on a huge tree duplicates
that content into the new layer rather than just touching metadata. The
fix: only `chown` directories that actually need to be *written to* at
runtime (here, just the empty `/data` mount point — the app never writes
inside `/app` itself), and do it non-recursively where possible.

**`api` image size**: dropped from ~886MB to ~300MB by decoupling
`requirements-api.txt` from `requirements.txt`. The API never imports
Streamlit, pandas, pyarrow, altair, or openpyxl — `route_query()`'s entire
reachable call graph only needs `openai` and `python-dotenv` from what
`requirements.txt` provides (verified via `grep -rhE "^import |^from " src/
apps/api/` before trimming). The `web` image is still ~2GB — a known,
already-documented tradeoff (full `node_modules`, not a pruned
"standalone" build, because the Prisma CLI needs its full dependency tree
to run `migrate deploy` against the mounted volume at startup).

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

## Known warnings

- **`prisma:warn Prisma failed to detect the libssl/openssl version...
  Defaulting to "openssl-1.1.x"`** — printed by `prisma generate` (build
  time) and `prisma migrate deploy` (every container start) on the
  `node:20-slim` base image. **Harmless in this stack**: Prisma 7's
  `@prisma/adapter-libsql` driver adapter does all database communication
  through `libsql` itself, not Prisma's traditional native query-engine
  binary — the binary this warning is actually about is never used here.
  Confirmed by the stack working end-to-end (migrations apply, all CRUD
  operations succeed) despite the warning appearing on every startup. If a
  future change reintroduces a real Prisma query-engine dependency, this
  warning would need to be taken seriously and fixed via `apt-get install
  openssl` in the Dockerfile — it currently is not.
- **`npm notice` / `X moderate severity vulnerabilities`** during `npm ci`
  in the build log — standard `npm audit` noise from the dependency tree,
  not specific to this project's own code. Not addressed by this phase;
  revisit with `npm audit` before any production deployment.

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
- **Login keeps failing even with the correct password**: a per-process
  brute-force limiter (Phase 9 audit) blocks further attempts after 5
  failures within 60 seconds — including from the login form itself
  retrying. Wait a minute, or restart the `web` container to clear the
  in-memory counter immediately. See `docs/AUTH_AND_PERSISTENCE.md`.
