# Next Phases — Recommendations and Risks

**Status as of Phase 10:** the SaaS migration (Streamlit prototype →
Next.js + FastAPI + Docker Compose, with login and per-user conversation
persistence) is functionally complete and locally validated; Phase 9 was a
production-readiness audit that fixed the Critical/High findings in place
(see `docs/AUDIT_PHASE_9.md`), a follow-up pass then implemented most of
the previously-documented-only Medium/Low findings (CORS configurability,
`/chat` frequency rate limiting, security headers, CI, container
hardening), and Phase 10 closed the single biggest item left standing:
`apps/api` now cryptographically verifies every `/chat`/`/tools` caller
instead of trusting anyone who can reach it on the network (see
`docs/API_AUTHENTICATION.md`). What follows is a forward-looking
recommendation, not a commitment — nothing here is scheduled or approved.
See `docs/SAAS_MIGRATION_PLAN.md` §11 for what was actually built through
Phase 8H and any deviations from the original plan.

This document exists so the next decision — "what do we build next" — is
made deliberately, informed by what's genuinely missing, rather than by
momentum.

---

## Recommended next phases (roughly in order)

1. ~~**Automated CI**~~ — done: `.github/workflows/ci.yml` runs
   `npm run lint/build/test` and `pytest`/`py_compile` on every push/PR.
2. **Real user accounts** — replace the single shared password
   (`APP_ACCESS_PASSWORD`) with actual per-user credentials. The codebase
   is already shaped for this: `lib/auth-credentials.ts`'s `authorize()`
   already returns a `User` object, `Conversation`/`Message` ownership is
   already a real foreign key to `User.id`, and — since Phase 10 — the
   inter-service JWT's `sub` claim already carries whatever id Auth.js's
   session produces, no redesign needed there either (see
   `docs/API_AUTHENTICATION.md`'s "Compatibility with future
   multi-user/roles" section). This is the highest-leverage next step —
   most other user-facing improvements assume real accounts exist.
3. **Postgres migration for `apps/web`'s database** — the Prisma schema was
   deliberately designed to make this a `provider`/`DATABASE_URL` change,
   not a data-model change. Needed before any deployment with more than one
   running instance of `apps/web` (SQLite files don't coordinate across
   processes/containers).
4. ~~**Rate limiting on `/chat`**~~ — done: capped at 30 requests/60s,
   globally (same in-memory, per-process, single-instance-only limitation
   as the login limiter — revisit both together if this is ever
   horizontally scaled).
5. **Structured logging / monitoring** for `apps/web` and `apps/api`
   (request logs, error tracking) — today, errors are caught and hidden
   from the client (correctly, for security) but not captured anywhere
   observable either. `src/services/odoo_security.py`'s audit log is the
   only structured logging that exists right now, and it's Odoo-specific.
6. **Production deployment of the SaaS stack** — `docker-compose.saas.yml`
   is local-only by design (see `docs/DOCKER_SAAS_STACK.md`). A real
   deployment needs: a real domain + TLS (the Phase 10 auth token proves
   *identity*, not *confidentiality in transit* — see
   `docs/API_AUTHENTICATION.md`'s threat model), secrets management (not
   `.env` files), the Postgres migration above, a real
   `API_AUTH_SECRET`-rotation story if this is ever horizontally scaled
   (see `docs/API_AUTHENTICATION.md`'s rotation section — not implemented
   yet, deliberately), and a decision on hosting (Vercel for `apps/web`, a
   container host for `apps/api`, matching the original plan in
   `docs/SAAS_MIGRATION_PLAN.md` §7).
7. **Conversation list UX at scale** — pagination/search once a user has
   more than a screenful of conversations (today's sidebar loads everything
   unbounded).
8. **Decide the Streamlit app's fate** — it still runs standalone and
   duplicates no logic (`app.py` and `apps/web` both call the same
   unchanged `route_query()`), but it's a second UI to maintain
   indefinitely. Worth an explicit decision (keep both, deprecate one) once
   the Next.js stack has real users, rather than by default.

---

## What should NOT be built yet

Carried forward from every migration phase's hard rules — repeating here
because "documentation finalization" is exactly the moment scope quietly
creeps if it isn't restated:

- **Billing / subscriptions / Stripe** — no pricing model, no plan tiers,
  no payment processing. Nothing in the current architecture assumes this
  is coming, and nothing should be added in anticipation of it.
- **Multi-tenancy** — one Odoo connection, one set of business data. Do not
  add "organization" or "tenant" concepts speculatively.
- **Organizations / teams / shared workspaces** — conversations belong to a
  user, not a team; there is no sharing model and none should be
  half-built ahead of real multi-user accounts existing.
- **User roles / permissions tiers** — meaningless with a single shared
  account; don't add role fields "for later" before real accounts exist —
  build accounts first, then roles, informed by actual needs.
- **Admin dashboard** — no user base to administer yet.
- **Scheduled jobs / push notifications / email reports** — explicitly
  deferred since Phase 8A's original migration plan; still out of scope.
- **Any change to `src/`, `route_query()`, or the Odoo read-only security
  model** — every phase of this migration, including this one, has kept
  that boundary absolute. That discipline should outlast the migration
  itself, not just apply to it.

---

## Risks before any public SaaS launch

These are not blockers to continued local/internal use — they're a
checklist for the specific moment this stops being "a personal tool
running on my machine" and becomes something other people log into.

| Risk | Why it matters | Where it's tracked |
|---|---|---|
| Inter-service auth token transits the browser | `apps/api`'s Phase 10 token is attached client-side (`lib/api.ts` calls `apps/api` directly from the browser), so it's visible in the Network tab / to any script with page access. Bounded by a 5-minute lifetime, and this codebase has no XSS vector today (verified: no `dangerouslySetInnerHTML`, no `rehype-raw`) — but it is not zero exposure, and a full server-side-proxy redesign (never sending the token client-side at all) was explicitly out of scope for Phase 10 | `docs/API_AUTHENTICATION.md` (Threat model) |
| No authorization model beyond authentication | Phase 10 verifies *identity* (is this a genuine caller); every valid token still asserts the same single account, so there's no per-user permission distinction to make yet — not a gap so much as "nothing to attach roles to until real accounts (item 2 above) exist" | `docs/API_AUTHENTICATION.md` |
| `API_AUTH_SECRET` has no rotation mechanism | Rotating today means updating both services and accepting a brief (sub-5-minute, self-healing) window of failed requests — fine for the current single-operator model, not for a zero-downtime production requirement | `docs/API_AUTHENTICATION.md` (Rotation strategy) |
| Single shared password | Anyone who has it has full access to everything; no per-user isolation, no revocation without changing the password for everyone | `docs/AUTH_AND_PERSISTENCE.md` |
| Login *and* `/chat` rate limiting are per-process, not distributed | Both are now enforced (5 login attempts/60s in `authorize()`; 30 `/chat` calls/60s in `apps/api/main.py`), but both are in-memory: resets on restart, doesn't coordinate across multiple instances | `docs/AUTH_AND_PERSISTENCE.md`, `docs/API_CONTRACT.md` |
| SQLite under concurrent load | File-based SQLite does not safely coordinate writes across multiple processes/instances the way a real production database needs to | `docs/AUTH_AND_PERSISTENCE.md` |
| Secrets in plain `.env` files | Fine for local dev; not an acceptable secrets story for a real deployment (no rotation, no access control, easy to leak via a misconfigured `.dockerignore`/`.gitignore`) | `docs/DOCKER_SAAS_STACK.md` |
| No monitoring/alerting | A production outage or a runaway OpenAI cost would currently be discovered by a user complaining, not by the system telling anyone | this document, §"Recommended next phases" |
| Odoo read-only guarantee under new load patterns | Not weakened by anything in this migration (verified per-phase via `git diff --stat -- src/` staying empty and `tests/test_security.py` passing unchanged) — but worth re-verifying against real production traffic patterns before trusting it at scale | `SECURITY_REVIEW.md` |

Resolved since the table above was first written: CORS is now
configurable (`CORS_ALLOWED_ORIGINS`, defaults to `localhost:3000`),
baseline security headers (`X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`) are now set on every `apps/web` response, and — the
biggest one — `apps/api` no longer trusts callers based on network access
alone; every `/chat`/`/tools` request now carries a cryptographically
verified, short-lived token (Phase 10, `docs/API_AUTHENTICATION.md`). The
residual risks from *that* change are the first three rows of the table
above, not a repeat of the original finding.

None of these are urgent for continued personal/internal use of either
front end. They become urgent the moment "who can log in" expands beyond
the person who set `APP_ACCESS_PASSWORD`.
