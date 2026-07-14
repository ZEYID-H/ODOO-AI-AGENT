# Project Development Guide

**This is the single governing document for all future development in this repository.**
Module plans (e.g. `docs/DELIVERY_MANAGEMENT_PLAN.md`), historical phase documents, and
README files defer to it. Where an older document disagrees with this one, this one wins.
Governance notes previously scattered across `docs/NEXT_PHASES.md`,
`docs/SAAS_MIGRATION_PLAN.md`, and individual phase docs are consolidated here; those
documents remain valuable as history and reference, not as authority.

---

## 1. System Architecture

Four deliverables share one repository:

```
src/                    Core business logic: AI tools, agent router (route_query()),
                        Odoo read-only gateway, formatting. FROZEN — see §3.
app.py                  Streamlit prototype UI. Calls route_query() directly. FROZEN.
apps/api                FastAPI service. Thin authenticated wrapper around the
                        unchanged src/ logic (/chat, /tools). Verifies short-lived
                        signed tokens (see docs/API_AUTHENTICATION.md).
apps/web                Next.js SaaS app. Login (Auth.js), chat UI, conversation
                        persistence (Prisma/SQLite on a Docker volume), and all
                        future user-facing modules.
```

Runtime topology (`docker-compose.saas.yml`, local-only by design):

```
Browser ──► apps/web (Next.js, :3000) ──► Prisma ──► SQLite on volume /data
   │
   └──────► apps/api (FastAPI, :8000) ──► src/ ──► Odoo (read-only) / mock data
            (signed token minted by apps/web — Phase 10)
```

## 2. Module Ownership

| Concern | Owner | Never owned by |
|---|---|---|
| AI routing, tools, prompts | `src/` | apps/web, apps/api |
| Odoo access (read-only, always) | `src/services/` | anything else |
| HTTP exposure of AI/business logic | `apps/api` | apps/web server actions |
| Auth, sessions, roles | `apps/web` (Auth.js) | apps/api, src/ |
| User-facing persistence (conversations, future modules) | `apps/web` (Prisma) | src/ |
| New user-facing features (e.g. Delivery Management) | `apps/web` | src/, app.py |

A feature belongs to exactly one module per phase. Cross-module changes in a single
phase are forbidden; if a phase turns out to need one, stop and re-plan.

## 3. Hard Boundaries (the untouchable list)

These hold across every phase of every module unless a plan explicitly, with approval,
says otherwise:

- **`src/`** — all of it: `src/tools/`, `src/agent/` including `route_query()`,
  `src/services/` (Odoo gateway and its read-only security model), formatting, mock
  data. Verified per phase: `git diff --stat -- src/` must be empty.
- **`app.py`** — the Streamlit UI runs unchanged.
- **`apps/api` business logic** — `main.py`, `auth.py`, `schemas.py`: no new
  endpoints, no changed contracts, unless a plan approves it.
- **The Odoo read-only guarantee** — nothing, in any module, ever acquires Odoo write
  access.
- **Secrets** — never committed. `.env*` files are git-ignored; `*.example` files
  carry placeholder values only.

Standard boundary check, run before every commit:

```
git diff --stat -- src/ app.py apps/api/main.py apps/api/schemas.py
```

It must be empty (unless the approved plan for that phase says otherwise).

## 4. Development Workflow — the Planning Gate

Before implementing ANY feature, present this plan and WAIT for approval:

1. Identify the owning module.
2. Explain why that module owns the feature.
3. List all files expected to change.
4. List all files that must remain untouched.
5. Identify architecture risks.
6. Wait for approval.

Only after approval: implement → test → Docker validate → update docs if needed →
commit → push.

Rules of the gate:

- Never skip the planning step. Never mix modules in one implementation phase.
- An explicit, detailed phase instruction from the user counts as approval for that
  phase's stated scope — and nothing beyond it.
- **Stop-on-surprise:** if implementation reveals a different architectural direction
  than planned, STOP immediately, explain the findings, and request approval before
  proceeding. A failing stop condition means no commit.

### Server Action authorization (permanent rule — D1.1, no exceptions)

Every Server Action is a directly invokable RPC endpoint — page-level gating
protects nothing an attacker calls directly. Therefore every Server Action must
begin, before ANY business logic:

```
requireSession()          — or requireActionSession() in actions
        ↓
requireRole(...)          — or requireActionRole(...) when authorization is required
        ↓
business logic
```

- Actions use the **throwing** variants (`requireActionSession` /
  `requireActionRole` in `apps/web/lib/session-guard.ts`); pages use the
  redirecting ones. An action's failure mode is a refused call, never a
  navigation hint, and its error messages stay generic (reveal that access was
  refused, never why or what exists).
- The ONLY exempt actions are the authentication boundary itself
  (`loginAction`/`logoutAction` in `app/actions/auth.ts`), which cannot require
  the session they exist to establish/destroy. Nothing else is exempt, ever.
- Ownership scoping (e.g. `findOwnedConversation`) is a second, independent
  check inside the business logic — a role gate is not a substitute for it.
- Conversations are AI-Assistant functionality and therefore OWNER-only. If
  drivers ever get conversation features of their own, that is a new feature
  behind this gate's full planning process — not a loosening of the guard.
- Every new Server Action ships with tests proving it rejects: no session, the
  wrong role, and (where applicable) the right role but someone else's data.

## 5. MVP First (guiding principle)

Every phase solves **one operational problem only**.

- Never build future architecture before it becomes necessary. No speculative
  organizations, tenants, permission matrices, plugin systems, or "we'll need it
  later" fields.
- Prefer **evolutionary architecture over speculative architecture**: make the
  smallest change that solves today's problem while not blocking tomorrow's — then
  stop. "Doesn't block later" is the bar, not "already supports later."
- When two designs both work, choose the one with fewer new concepts, fewer new
  files, and fewer new dependencies.
- The moment a phase's scope grows a second problem, split it into another phase.

## 6. Validation Standard

Every implementation phase runs the applicable subset (and says which were skipped and
why in its report):

- **Frontend:** `npm run lint`, `npm run build`, `npm run test` (in `apps/web`)
- **Backend (boundary proof — must stay green unchanged):**
  `python -m pytest apps/api/tests -v`, `python -m pytest tests/`,
  `python -m py_compile app.py apps/api/main.py`
- **Prisma (schema-changing phases):** `prisma generate`, `prisma migrate status`,
  migration tested against a fresh database
- **Docker (runtime-affecting phases):**
  `docker compose -f docker-compose.saas.yml build && up`, then validate the
  phase's stated behaviors in the running stack, including persistence across
  restart where relevant
- **Git:** `git status --short`, the §3 boundary check, and a no-secrets review of
  the diff

## 7. Phase Report Format

Every phase ends with a report: phase completed; module owner; files created; files
modified; files NOT touched (explicit §3 confirmation); role/security behavior
verified; storage behavior if applicable; validation results per checklist item;
Docker results if applicable; known issues; git commit hash; safe to continue (yes/no
and what comes next). No next phase starts without approval of the previous report.

## 8. Document Map

| Document | Role |
|---|---|
| `docs/PROJECT_DEVELOPMENT_GUIDE.md` | **Governing document (this file)** |
| `docs/AI_AGENT_COMPLETION_PLAN.md` | **Authoritative roadmap for completing and releasing the core Odoo AI Agent** (AG1–AG8, current top priority) — tool inventory, gap analysis, release milestones |
| `docs/REMAINING_PROJECT_ROADMAP.md` | Authoritative roadmap for Delivery Management's remaining work (D9 onward) and the OCR, Analytics, Infrastructure, and SaaS tracks — currently **paused** until the AI Agent plan's Milestone C ships |
| `docs/DELIVERY_MANAGEMENT_PLAN.md` | Delivery Management module plan: detailed D1–D8 phase history and design (completed, frozen); see the roadmap above for D9 onward |
| `docs/NEXT_PHASES.md` | Historical recommendations/risk register from the SaaS migration; superseded on governance by this guide |
| `docs/SAAS_MIGRATION_PLAN.md` | Historical record of the Streamlit → SaaS migration (Phases 8A–8H) |
| `docs/API_AUTHENTICATION.md` | apps/web ↔ apps/api trust boundary (Phase 10) |
| `docs/AUTH_AND_PERSISTENCE.md` | Auth.js + Prisma persistence design |
| `docs/DOCKER_SAAS_STACK.md` | Compose stack, volumes, networking |
| `docs/API_CONTRACT.md` | apps/api endpoint contract |
| `SECURITY_REVIEW.md`, `docs/AUDIT_PHASE_9.md` | Security posture and audit history |

## 9. Active Modules

- **Odoo AI Agent (core product)** — the current top priority. Tool registry,
  routing, and the `apps/web`/`apps/api` chat surface are functional and tested,
  but v1 release readiness (evaluation coverage, live-Odoo validation, production
  deployment) is not yet complete. **Planned in
  `docs/AI_AGENT_COMPLETION_PLAN.md`** (phases AG1–AG8) — consult it before
  starting any AI Agent work.
- **Delivery Management** — D1 through D8 are complete and shipped (see
  `docs/DELIVERY_MANAGEMENT_PLAN.md` §9 for the detailed per-phase history). This
  module superseded, with approval, the "no user roles yet" and "no admin dashboard
  yet" entries in `docs/NEXT_PHASES.md` via a minimal identity foundation in D1
  (OWNER/DRIVER roles, individual username/password accounts on the existing `User`
  model; no user-management system). A shared driver password was explicitly
  rejected: delivery proofs must be attributable to an individual driver from the
  first record. **The module is now frozen** — D9 (Internal Pilot Readiness) and
  all later Delivery/OCR/Analytics/Infrastructure/SaaS tracks are paused until the
  AI Agent Completion Plan's Milestone C ships; see
  `docs/REMAINING_PROJECT_ROADMAP.md` for that paused roadmap. Delivery D1–D8 stays
  fully in place and untouched unless a critical shared-platform regression is
  found.
