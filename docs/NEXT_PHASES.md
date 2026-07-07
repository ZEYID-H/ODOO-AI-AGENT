# Next Phases — Recommendations and Risks

**Status as of Phase 8H:** the SaaS migration (Streamlit prototype →
Next.js + FastAPI + Docker Compose, with login and per-user conversation
persistence) is functionally complete and locally validated. What follows
is a forward-looking recommendation, not a commitment — nothing here is
scheduled or approved. See `docs/SAAS_MIGRATION_PLAN.md` §11 for what was
actually built through Phase 8H and any deviations from the original plan.

This document exists so the next decision — "what do we build next" — is
made deliberately, informed by what's genuinely missing, rather than by
momentum.

---

## Recommended next phases (roughly in order)

1. **Automated CI** — run the existing validation suite (`npm run
   lint/build/test`, `pytest apps/api/tests`, `pytest tests/`, `py_compile`)
   on every push/PR. Nothing here requires new test-writing — the suites
   already exist and pass locally; this is wiring, not development.
2. **Real user accounts** — replace the single shared password
   (`APP_ACCESS_PASSWORD`) with actual per-user credentials. The codebase
   is already shaped for this: `lib/auth-credentials.ts`'s `authorize()`
   already returns a `User` object, and `Conversation`/`Message` ownership
   is already a real foreign key to `User.id`, not a loose string match
   (see `docs/AUTH_AND_PERSISTENCE.md`). This is the highest-leverage next
   step — most other user-facing improvements assume real accounts exist.
3. **Postgres migration for `apps/web`'s database** — the Prisma schema was
   deliberately designed to make this a `provider`/`DATABASE_URL` change,
   not a data-model change. Needed before any deployment with more than one
   running instance of `apps/web` (SQLite files don't coordinate across
   processes/containers).
4. **Rate limiting** — on `/chat` (API cost control) and on login (brute-force
   protection on the shared password, or its replacement).
5. **Structured logging / monitoring** for `apps/web` and `apps/api`
   (request logs, error tracking) — today, errors are caught and hidden
   from the client (correctly, for security) but not captured anywhere
   observable either. `src/services/odoo_security.py`'s audit log is the
   only structured logging that exists right now, and it's Odoo-specific.
6. **Production deployment of the SaaS stack** — `docker-compose.saas.yml`
   is local-only by design (see `docs/DOCKER_SAAS_STACK.md`). A real
   deployment needs: a real domain + TLS, secrets management (not `.env`
   files), the Postgres migration above, and a decision on hosting
   (Vercel for `apps/web`, a container host for `apps/api`, matching the
   original plan in `docs/SAAS_MIGRATION_PLAN.md` §7).
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
| Single shared password | Anyone who has it has full access to everything; no per-user isolation, no revocation without changing the password for everyone | `docs/AUTH_AND_PERSISTENCE.md` |
| No rate limiting anywhere | Unbounded `/chat` calls are unbounded OpenAI spend; unbounded login attempts are a brute-force surface | `docs/AUTH_AND_PERSISTENCE.md`, `docs/API_CONTRACT.md` |
| SQLite under concurrent load | File-based SQLite does not safely coordinate writes across multiple processes/instances the way a real production database needs to | `docs/AUTH_AND_PERSISTENCE.md` |
| Secrets in plain `.env` files | Fine for local dev; not an acceptable secrets story for a real deployment (no rotation, no access control, easy to leak via a misconfigured `.dockerignore`/`.gitignore`) | `docs/DOCKER_SAAS_STACK.md` |
| No monitoring/alerting | A production outage or a runaway OpenAI cost would currently be discovered by a user complaining, not by the system telling anyone | this document, §"Recommended next phases" |
| CORS hardcoded to `localhost:3000` | Correct for local dev; must be revisited for any real domain before launch, or every browser request to `/chat`/`/tools` will be blocked | `docs/API_CONTRACT.md` |
| Odoo read-only guarantee under new load patterns | Not weakened by anything in this migration (verified per-phase via `git diff --stat -- src/` staying empty and `tests/test_security.py` passing unchanged) — but worth re-verifying against real production traffic patterns before trusting it at scale | `SECURITY_REVIEW.md` |

None of these are urgent for continued personal/internal use of either
front end. They become urgent the moment "who can log in" expands beyond
the person who set `APP_ACCESS_PASSWORD`.
