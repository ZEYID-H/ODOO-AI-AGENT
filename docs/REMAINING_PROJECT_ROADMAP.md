# Remaining Project Roadmap — Kaizera AI Platform

**Status:** Authoritative roadmap for all work remaining after the Delivery Management
module's identity/upload/review/dashboard foundation. Governed by
`docs/PROJECT_DEVELOPMENT_GUIDE.md` (architecture boundaries, the planning gate, the
Server Action authorization rule) and, for Delivery-specific phase history, by
`docs/DELIVERY_MANAGEMENT_PLAN.md`. This document does not replace either — it is
where cross-track sequencing and everything beyond Delivery lives.

**⚠️ Correction to this document's own commissioning brief:** the request that produced
this roadmap listed "D6.2 — Driver Summary Semantics Closure" as the *current exact
next phase*, not-yet-started. That is stale. Verified against the actual repository
(not assumed): commit `e98cd84` ("D6.2: driver summary semantics closure — all four
cards day-scoped"), `docs/DELIVERY_MANAGEMENT_PLAN.md` §9's own roadmap-status table,
202 passing tests including 8 D6.2-specific ones, and a live Docker verification run
already recorded D6.2 as **complete**. This document reflects that reality: D6.2 is
listed under *Completed*, not *Future*, and the recommended immediate next phase is
**D7**, not D6.2. See "Documentation Validation" at the end of this file for the full
verification trail.

---

## 1. Verified Current State

Checked against the repository directly (git log, migrations directory, test suite,
running Docker stack), not inferred from prior planning documents alone.

### Platform foundation (pre-Delivery-module, from the SaaS migration — Phases 1–10)

- Streamlit prototype preserved and running unchanged (`app.py`)
- Next.js frontend (`apps/web`) — App Router, Auth.js, Prisma
- FastAPI backend (`apps/api`) — thin authenticated wrapper around `src/`
- AI/Odoo business logic untouched in `src/` throughout every phase (verified per
  phase via `git diff --stat -- src/`)
- Auth.js (NextAuth v5) authentication, JWT session strategy
- Prisma ORM, SQLite via `@prisma/adapter-libsql` for development
- Docker Compose SaaS stack (`docker-compose.saas.yml`) — `web` + `api`, one
  persistent volume, non-root containers, `cap_drop: ALL`
- CI (`.github/workflows/ci.yml`) running lint/build/test and pytest on every push/PR
- Security hardening from the Phase 9 audit (rate limiting, CORS configurability,
  security headers, container hardening) — see `docs/AUDIT_PHASE_9.md`
- Signed short-lived JWT trust boundary between `apps/web` and `apps/api` (Phase 10 —
  see `docs/API_AUTHENTICATION.md`)
- Conversation persistence (`Conversation`/`Message` models, owned by `User`)
- Server-side session guards (`requireSession()`/`requireRole()` for pages,
  `requireActionSession()`/`requireActionRole()` for Server Actions — see
  `docs/PROJECT_DEVELOPMENT_GUIDE.md` §4, the permanent authorization rule)

### Delivery Management module — completed (D1 → D6.2)

| Phase | What shipped | Commit |
|---|---|---|
| D1 | Minimal identity foundation — OWNER/DRIVER roles, individual username/password accounts | `2f3df70` |
| D1.1 | Security closure — every Server Action role-gated; conversations OWNER-only | `e656b35` |
| D2 | Delivery Proof data model — metadata persistence, guarded actions | `3bf7b4c` |
| D3 | Driver upload MVP — image storage, authenticated serving, mobile UI | `ed181c4` |
| D4 | Owner review workflow — queue, details page, verify/reject audit trail | `449d4ed` |
| D5 | OCR readiness data foundation — schema fields + guarded recorder, no engine | `04a2df3` |
| D6 | Driver dashboard & delivery status — today's summary, recent uploads, detail view | `b389ccc` |
| D6.1 | Business timezone closure — `BUSINESS_TIMEZONE`-aware day boundaries | `262442b` |
| D6.2 | Driver summary semantics closure — all four summary cards day-scoped consistently | `e98cd84` |

Full per-phase design and validation history: `docs/DELIVERY_MANAGEMENT_PLAN.md` §9.

### Explicitly NOT built yet (confirmed absent from the codebase)

- **No OCR engine** — D5 added only nullable schema fields and one guarded, unused
  write path (`recordOcrResult`); no extraction code exists.
- **No Odoo invoice matching** — nothing in `apps/web` or `apps/api` cross-references
  delivery proofs against Odoo invoices.
- **No public multi-tenant SaaS** — one shared Odoo connection, no `Organization`
  model, no per-tenant anything. `docs/NEXT_PHASES.md` §"What should NOT be built yet"
  still applies to multi-tenancy, billing, and admin user-management UI.
- **No driver resubmission, no notifications, no analytics, no object storage, no
  Postgres, no production deployment.**

---

## 2. Roadmap Principles

These govern every phase below and are non-negotiable without an explicit
re-approval, per the planning gate in `docs/PROJECT_DEVELOPMENT_GUIDE.md` §4:

1. **Internal operational success comes before public SaaS expansion.** Kaizera's own
   delivery workflow replacing WhatsApp is the near-term goal; multi-tenant SaaS is a
   later, separate decision.
2. **Every phase solves one operational problem only.** No phase bundles two problems
   because it's "convenient while we're in the file."
3. **Do not combine Delivery, OCR, Analytics, Infrastructure, and SaaS work.** These
   are five separate tracks (§4–§8 below) with independent sequencing; a phase in one
   track does not casually reach into another.
4. **OCR must not block launching the core Delivery workflow internally.** The
   Delivery MVP (Track 1) must reach its internal pilot and be accepted as a WhatsApp
   replacement candidate *before* OCR work (Track 2) begins in earnest.
5. **Every phase requires:** planning (the 6-step gate) → implementation → tests →
   Docker validation → documentation when needed → commit → push → **stop**. No phase
   proceeds to the next without this cycle completing and being reported.
6. **A future phase must not be silently implemented early.** If work in progress
   reveals a later phase's concern, stop and flag it — do not fold it in.
7. **Protected architectural boundaries:** `src/`, `app.py`, `route_query()`, the AI
   tools, and the read-only Odoo gateway. No phase in this roadmap touches them except
   where a track (O4, O5) explicitly and narrowly extends read-only Odoo access
   through the *existing* gateway — never a new write path, never a bypass.
8. **Next.js must never call Odoo directly.** All Odoo access — present and future —
   goes through `src/services/` via `apps/api`, exactly as today's chat flow does.
9. **User identity must always come from the trusted server session.** No phase
   accepts a client-supplied user id, driver id, or tenant id for anything
   security-relevant.
10. **Every Server Action follows:** `requireActionSession()` → `requireActionRole()`
    → business logic. No exceptions beyond the two already-documented ones
    (`loginAction`/`logoutAction` — the auth boundary itself).

---

## 3. Track 1 — Delivery Workflow Completion

Owner: `apps/web`. Goal: make the Delivery module a full, trustworthy replacement for
the WhatsApp photo workflow, validated with real drivers, before OCR work begins.

### D6.2 — Driver Summary Semantics Closure ✅ COMPLETE

Documented here for track continuity only — **this phase is done**, not upcoming.

- **Goal (as delivered):** all four Today's Summary cards (Uploaded/Pending/Verified/
  Rejected) represent proofs uploaded during the same current business-day range, not
  a mix of day-scoped and all-time counts.
- **Delivered:** `getMyDeliveryProofSummary` rewritten to a single `groupBy` query
  over today's business-day range (`lib/business-time.ts`), driver-scoped from the
  session; UI labels clarified ("Pending today" etc.); 8 new tests (202 total) proving
  per-status day-scoping, both boundaries, and cross-driver isolation; verified live
  against Docker with controlled records matching database ground truth exactly.
- **Commit:** `e98cd84`. Full report: this conversation's D6.2 phase report, mirrored
  in `docs/DELIVERY_MANAGEMENT_PLAN.md` §9.

---

### D7 — Rejected Proof Resubmission ✅ COMPLETE

**Delivered exactly as planned below**, with one resolved decision: the D7 planning
gate chose `DeliveryProofAttempt` child records (the preferred option named in this
plan) over versioned file metadata. Every requirement in this section shipped —
atomic attempt-1 creation with every new proof, server-computed sequential attempt
numbers, atomic parent+latest-attempt updates on every review, OCR fields reset (not
re-run) on resubmission, old images never deleted, attempt-history images served
under the same authorization boundary as the current image
(`/api/proofs/[id]/attempts/[attemptId]/image`, sharing `lib/image-auth.ts` with the
existing route). 42 new tests (244 total), including an automated replay of the real
migration SQL against a reconstructed pre-D7 database (pending/verified/rejected/
null-image scenarios) and a real concurrent-resubmission test (not simulated only).
Verified live against the actual Docker volume's pre-existing historical proofs — a
real REJECTED proof was carried through resubmit → reject → resubmit → verify
(attempts 1→2→3), with older attempts retaining their own distinct rejection reasons
throughout, and all of it survived a full container restart. Full design rationale:
`docs/DELIVERY_MANAGEMENT_PLAN.md` §9's D7 write-up; commit hash in that phase's
final report.

**Below is the original phase plan, kept for its design rationale — see the
Delivered note above for what actually shipped and where it diverged (none did).**

- **Module owner:** `apps/web`
- **Goal:** allow a driver to replace or resubmit a rejected delivery-proof image.
- **Operational problem solved:** today a rejected proof is a dead end — the driver
  has no way to correct and resubmit without contacting the office, defeating the
  point of removing WhatsApp from the loop.
- **Dependencies:** D2 (`DeliveryProof` model), D3 (upload/storage pipeline), D4
  (review/reject workflow and its atomicity guarantee).
- **Exact scope:**
  - Only the proof-owning `DRIVER` may resubmit (session-scoped, as everywhere else).
  - Only `REJECTED` proofs may be resubmitted — not `PENDING`, not `VERIFIED`.
  - The owner's original rejection reason must remain visible after resubmission
    (audit trail, not overwritten).
  - Preserve a full audit history of attempts — no destructive overwrite of prior
    evidence. **Decide at the D7 planning gate** between:
    - `DeliveryProofAttempt` child records (preferred for auditability — each
      attempt is its own row with its own image/timestamp/outcome), or
    - versioned file metadata on the existing row (simpler, weaker history).

      The plan must state which was chosen and why before implementation begins.
  - The new image is validated using the *existing* upload rules (magic-byte type
    check, size cap, server-generated filename) — no new validation regime invented.
  - Status returns to `PENDING` after a successful resubmission.
  - Rejection fields (`rejectionReason`, `verifiedAt`, `verifiedById`) are cleared
    appropriately on the *current* record when it re-enters `PENDING` — but only if
    the audit design (above) doesn't already preserve them on a prior-attempt row.
  - `OWNER` must be able to see the resubmission history on the details page.
- **Explicit out of scope:** notifications (D8), OCR re-run (O2+), Odoo matching
  (O4), multi-image proofs, resubmission limits/cooldowns (revisit only if the pilot
  shows abuse).
- **Likely files/folders:** `apps/web/prisma/schema.prisma` (new model or new
  columns — migration required either way), `app/actions/delivery-proofs.ts` (new
  guarded action, e.g. `resubmitDeliveryProof`), `app/driver/[id]/page.tsx` (add a
  resubmit control, only rendered when `status === "REJECTED"`),
  `app/dashboard/delivery-proof/[id]/page.tsx` (render attempt history for OWNER),
  `lib/file-storage.ts` (reused, not rewritten), `tests/*`.
- **Security requirements:** `requireActionRole("DRIVER")` first; ownership re-checked
  in the WHERE clause (never trust a client-supplied proof id alone); status
  transition atomic (`updateMany` with `status: "REJECTED"` in the WHERE, same
  pattern as D2's review chokepoint) so a resubmission can't race a fresh review; the
  image route's existing authorization (owner: all, driver: own, others: 404) must
  cover every historical attempt image, not just the current one.
- **Tests required:** driver can resubmit own rejected proof; driver cannot resubmit
  another driver's rejected proof; driver cannot resubmit a PENDING or VERIFIED
  proof; rejection reason remains visible after resubmission; status becomes PENDING;
  owner sees full attempt history; anonymous/wrong-role refused; existing D1–D6.2
  suites remain green.
- **Docker/runtime validation:** build, up; live resubmission by a real driver
  session; owner detail page shows history; image for each attempt independently
  authorized; restart persistence for both the new record(s) and their images.
- **Documentation required:** update `docs/DELIVERY_MANAGEMENT_PLAN.md` §9 roadmap
  status (D7 → completed) and, if `DeliveryProofAttempt` is chosen, document the new
  model in §5 alongside the existing `DeliveryProof` draft.
- **Stop conditions:** if resubmission design threatens to silently delete or
  overwrite rejection evidence; if it requires touching `src/`/`app.py`/Odoo/FastAPI
  business logic; if the audit-history decision can't be made without a schema
  redesign that risks existing data.
- **Release impact:** required for Milestone 1 (Internal Delivery MVP) — a delivery
  operation with no recovery path from a rejection is not a usable replacement for
  WhatsApp.

---

### D8 — Driver In-App Notifications ✅ COMPLETE

**Delivered exactly as planned below**, with the "prefer derived state" recommendation
followed all the way through: no `Notification` table was created; every event
(`VERIFIED`, `REJECTED`, `RESUBMITTED_PENDING`) is derived live from D7's already-
immutable `DeliveryProofAttempt` rows. Read/unread state uses one additive nullable
`User.deliveryNotificationsSeenAt` field (the plan's suggested design), evaluated
explicitly against a correctness edge case (a review landing in the exact window
between listing and mark-read) and kept anyway as the smallest safe option — a
monotonic sequence number would close that window fully but isn't justified at this
app's scale; documented, not hidden, in code. Historical baseline handled by an
additive migration backfilling every existing user's cursor to "now" at migration
time, so no pre-existing driver was flooded with a wall of historical unread events —
verified live against the real Docker volume's pre-existing users and attempts,
which produced a clean zero-badge baseline after upgrade. 26 new tests (270 total).
Full design rationale: `docs/DELIVERY_MANAGEMENT_PLAN.md` §9's D8 write-up.

**Below is the original phase plan, kept for its design rationale — see the
Delivered note above for what actually shipped (the derived-state path was used, as
recommended, with the read-cursor design named in that plan).**

- **Module owner:** `apps/web`
- **Goal:** give drivers a clear in-app notification/status inbox — no more finding
  out about a rejection only by manually re-checking the dashboard.
- **Operational problem solved:** a driver currently has to actively re-open the app
  to discover a proof was rejected; there's no push/pull signal.
- **Dependencies:** D4 (review outcomes), D7 (resubmission, so a notification can
  link to actionable follow-up).
- **Exact scope:**
  - Notification content: proof verified, proof rejected (+ reason), proof
    resubmitted and now pending.
  - Unread/read state — **only if justified** by real usage; the plan should default
    to *not* building it unless the pilot (D9) or early usage shows it's needed.
  - **Prefer deriving notifications from existing proof state/events** (i.e., compute
    "what changed since the driver last looked" from `DeliveryProof` rows and
    timestamps already being persisted) **before** creating a dedicated notification
    table/platform. A generic notification system is the fallback, not the default.
- **Explicit out of scope:** WhatsApp, email, push notifications (device-level),
  background queues/workers of any kind (the governing guide and every phase to date
  has avoided background jobs — this phase does not introduce the first one).
- **Likely files/folders:** `apps/web/app/actions/delivery-proofs.ts` (or a small new
  `notifications.ts` action file if derivation from existing state proves
  insufficient), `apps/web/app/driver/page.tsx` (inbox/badge UI), `tests/*`. A new
  Prisma model only if the derived-from-existing-state approach is tried first and
  found insufficient — that finding must be documented before adding one.
- **Security requirements:** driver sees only their own notifications/derived state;
  no cross-driver leakage (same isolation pattern as every other driver-scoped
  query); identity from session only.
- **Tests required:** correct notification content per event type; driver isolation;
  read/unread behavior if built; existing D1–D7 suites remain green.
- **Docker/runtime validation:** live verify/reject by owner produces the expected
  driver-visible signal; restart persistence if any new state is stored.
- **Documentation required:** update the Delivery plan roadmap status; document
  whether the derived-state or dedicated-table approach was used and why.
- **Stop conditions:** if achieving "clear" notifications is not possible without a
  background worker or an external delivery channel (push/email/SMS) — that would be
  scope creep into infrastructure this phase explicitly excludes; stop and re-plan
  rather than reach for a queue.
- **Release impact:** required for Milestone 1 — but scope must stay minimal per the
  "prefer derived state" rule above; do not let this phase balloon into a general
  notification platform.

---

### D9 — Internal Pilot and Operational Validation

- **Module owner:** operational (not a code-only phase) — `apps/web` for any
  bug-fix-only changes discovered during the pilot.
- **Goal:** run the Delivery module with real drivers before continuing into OCR, and
  formally decide whether the WhatsApp workflow can be retired.
- **Operational problem solved:** every phase so far has been validated by the
  engineer alone (Docker + curl + real accounts) — D9 is the first validation by the
  actual users (drivers and the owner) under real delivery conditions.
- **Dependencies:** D7, D8 (a driver needs a way to recover from a rejection and know
  it happened before a pilot is fair to run).
- **Exact scope — pilot checklist:**
  - Mobile usability verification (real phones, real network conditions, real camera
    behavior — not just desktop curl/browser testing).
  - Upload reliability (flaky connections, large photos, repeated attempts).
  - Owner-review workflow under real volume.
  - Rejection/resubmission workflow exercised for real.
  - Timezone correctness confirmed against actual Qatar business hours, not just
    synthetic test timestamps.
  - Storage usage monitored (volume growth rate, to inform Track 4's P1 timing).
  - Failure and recovery scenarios (what happens when a driver's upload fails
    mid-flight, when the app is restarted, when a driver has no signal).
  - A structured feedback log (not implemented in code — an operational document
    capturing driver/owner feedback).
  - **Scope discipline during the pilot: bug fixes only.** No new features land
    during D9; anything discovered that isn't a bug becomes a candidate for a later
    phase, planned normally.
- **Explicit out of scope:** any new feature; OCR; Odoo matching; anything from
  Track 3–5.
- **Likely files/folders:** none by default (this is an operational phase); any
  bug-fix commits during the pilot stay small and are each their own
  planned/tested/documented change, not a bundle.
- **Security requirements:** unchanged from D1–D8 — the pilot must not motivate any
  authorization shortcut ("just for testing").
- **Tests required:** any bug fix ships with a regression test, same as every other
  phase; no new test *suite* is inherent to D9 itself (it's a real-world validation
  activity, not a code-implementation phase).
- **Docker/runtime validation:** the pilot *is* the runtime validation, at a scale and
  realism no prior phase achieved.
- **Documentation required:** the pilot's feedback log; and, at the end, an explicit
  acceptance/non-acceptance decision recorded against the release gate below.
- **Stop conditions:** if the pilot surfaces a security or data-integrity problem,
  stop pilot usage until it's fixed and re-validated — do not continue collecting
  feedback on a known-broken guarantee.
- **Release impact:** D9's acceptance decision **is** Milestone 1.

**Internal Delivery MVP acceptance gate — accepted only when:**
- Drivers can upload without office assistance.
- Owners can review reliably.
- Rejected proofs can be corrected (D7 working in practice, not just in tests).
- No cross-driver leakage exists (re-confirmed under real multi-driver usage).
- Data and files survive restarts (re-confirmed under real deployment restarts, not
  just the engineer's `docker compose down/up`).
- The WhatsApp photo workflow can actually be retired — this is the concrete,
  business-facing success criterion the whole module exists to satisfy.

---

## 4. Track 2 — OCR Module

Owner: `apps/web` (application layer) coordinating with `apps/api`/`src/` only
through the existing read-only Odoo gateway pattern — never a new direct path.
**This track does not begin until Milestone 1 is reached** (Roadmap Principle 4).

### O1 — OCR Architecture and Engine Selection

- **Goal:** documentation and technical spike only — no engine implementation.
- **Operational problem solved:** none directly; this phase de-risks O2 by making
  irreversible-ish decisions (provider, execution model) deliberately instead of by
  accretion.
- **Dependencies:** D5 (the existing OCR-readiness schema fields this must design
  around), Milestone 1 acceptance.
- **Exact scope — decide and document:**
  - OCR provider/engine (cloud API vs. self-hosted; specific candidates compared).
  - Synchronous vs. background execution — and if background, **this is the first
    phase that would need to justify introducing a worker/queue**, which every prior
    phase has deliberately avoided; that justification must be explicit and approved,
    not assumed.
  - Worker identity and trust boundary (a background process has no user session —
    how does it authenticate to write `DeliveryProof` rows? See the D5 design note in
    `app/actions/delivery-proofs.ts` on `recordOcrResult`, which flagged exactly this
    as an O-track decision, not a D5 one).
  - Retry rules, timeout rules.
  - Image preprocessing needs (the D3 upload pipeline stores originals untouched —
    decide what preprocessing, if any, happens before OCR sees the image).
  - Cost and latency limits.
  - Privacy implications (invoice photos may contain customer PII — where does the
    image/text go, who processes it, what's retained by a third-party provider).
  - Status transition rules (building on D5's `NOT_STARTED | PROCESSING | COMPLETED |
    FAILED` vocabulary — confirm it's sufficient or document why it needs to grow).
  - How the existing D5 fields (`ocrText`, `ocrInvoiceNumber`, `ocrCustomerName`,
    `ocrConfidence`, `ocrProcessedAt`, `ocrError`) map to the chosen engine's output.
- **Explicit out of scope:** implementing the engine (that's O2); comparing options
  is required, but only enough to decide — this is not an open-ended survey.
- **Likely files/folders:** a new `docs/OCR_ARCHITECTURE.md` (or a section in this
  roadmap's future revision); no application code.
- **Security requirements:** the privacy/trust-boundary analysis above is itself a
  security requirement of this phase's output.
- **Tests required:** none (documentation phase).
- **Docker/runtime validation:** none (documentation phase).
- **Documentation required:** the architecture decision document is this phase's
  entire deliverable.
- **Stop conditions:** if engine selection surfaces a requirement to modify
  `src/`'s Odoo gateway or `route_query()` — stop and re-plan; O1 should conclude
  with a design that doesn't need that, given Roadmap Principle 7.
- **Release impact:** gates O2; contributes to Milestone 2.

### O2 — OCR Extraction Engine

- **Goal:** implement extraction of raw text, invoice number, customer name,
  confidence score, processing timestamp, and safe (non-leaking) error information.
- **Operational problem solved:** manual reading of delivery-proof photos to log
  invoice numbers is replaced by automatic extraction, reducing owner review time.
- **Dependencies:** O1's decisions; D5's schema and `recordOcrResult` write path.
- **Exact scope:** use the D5 data contract as-is unless O1 documented a needed
  change; explicit `PROCESSING`/`COMPLETED`/`FAILED` transitions (no silent partial
  states); idempotency (re-running extraction on the same proof is safe); bounded
  retries (no infinite retry loop); no OCR provider secrets ever reach browser code;
  no Odoo writes from this phase; unverified extracted data is OWNER-only (matches
  D5's existing view-layer separation — driver views never carried OCR fields and
  this phase does not change that).
- **Explicit out of scope:** manual correction UI (O3), Odoo matching (O4), exposing
  extraction to drivers.
- **Likely files/folders:** `apps/web/lib/ocr/` (new — engine client), extends
  `app/actions/delivery-proofs.ts`'s `recordOcrResult` caller (whatever O1 decided:
  a Server Action trigger, an API route, or a worker entry point), `tests/*`.
- **Security requirements:** the O1-decided worker/caller identity boundary is
  enforced here; `recordOcrResult`'s existing OWNER-only guard and strict input
  validation (confidence clamped 0–1, etc.) remain the write boundary.
- **Tests required:** extraction produces correctly-shaped results; status
  transitions correct; idempotent re-run; retry bound respected; failure path stores
  safe error info (no stack traces/secrets in `ocrError`); driver views still carry
  zero OCR fields; existing D1–D9 suites remain green.
- **Docker/runtime validation:** live extraction against a real uploaded proof in the
  running stack; restart persistence of OCR results.
- **Documentation required:** update this roadmap's Track 2 status and, if new
  environment variables are introduced (API keys etc.), add them to the env examples
  exactly as `BUSINESS_TIMEZONE`/`UPLOAD_DIR` were — non-secret plumbing documented,
  secrets never committed.
- **Stop conditions:** if extraction requires an Odoo write, a change to `src/`, or a
  background worker whose identity model wasn't approved in O1.
- **Release impact:** contributes to Milestone 2.

### O3 — OCR Manual Review and Correction

- **Goal:** let OWNER review and correct extracted values.
- **Operational problem solved:** OCR is never 100% reliable — this phase is what
  makes low-confidence or wrong extractions actually usable instead of silently
  trusted.
- **Dependencies:** O2.
- **Exact scope:** show original OCR values alongside corrected values; confidence
  display; manual override (owner types the correct value); re-run failed
  extraction; auditability of changes (who corrected what, when — same audit
  philosophy as D4's review trail).
- **Explicit out of scope:** exposing unreliable OCR results to drivers by default —
  this remains an owner-only surface unless a future phase explicitly decides
  otherwise, planned on its own.
- **Likely files/folders:** extends the D4/D5 owner details page
  (`app/dashboard/delivery-proof/[id]/page.tsx`, already has the OCR panel's slot
  reserved since D5), a new guarded correction action, `tests/*`.
- **Security requirements:** OWNER-only, same as O2; corrections re-validated with
  the same strict rules as the original extraction (length caps, etc.).
- **Tests required:** correction persists and is auditable; re-run failed extraction
  works; driver views unaffected; role gates hold.
- **Docker/runtime validation:** live correction flow against a real extracted proof.
- **Documentation required:** roadmap status update.
- **Stop conditions:** same protected-boundary conditions as every phase.
- **Release impact:** contributes to Milestone 2.

### O4 — Read-Only Odoo Invoice Matching

- **Goal:** match the corrected/extracted invoice number with an Odoo invoice.
- **Operational problem solved:** currently nothing connects a delivery proof to the
  actual Odoo invoice it's evidence for — this phase closes that loop, still without
  any Odoo write.
- **Dependencies:** O3 (matching should run against corrected, not raw, values);
  `src/services/` Odoo gateway (used, never modified — Roadmap Principle 7 and 8).
- **Exact scope:** read-only Odoo access only, through `apps/api`/`src/` exactly as
  the chat flow already does — Next.js never calls Odoo directly (Roadmap Principle
  8); exact matching first (no fuzzy matching as a first cut); normalization rules
  (whitespace, casing, common invoice-number formatting variance); safe handling of
  no match (clearly shown, not treated as an error); safe handling of multiple
  matches (owner must disambiguate, never auto-picked); owner confirmation required
  when uncertain; no automatic destructive linking (a match is a suggestion/link, not
  a mutation of Odoo data).
- **Explicit out of scope:** any Odoo write, any change to `src/services/`'s
  read-only guarantee, fuzzy/AI-assisted matching (a future refinement, not this
  phase).
- **Likely files/folders:** a new read-only query path in `src/services/` if one
  doesn't already exist for invoice lookup by number (extending, not modifying, the
  gateway's read-only surface — this is the one place this track touches `src/`, and
  only additively), `apps/api` endpoint exposing it, `apps/web` action + UI.
- **Security requirements:** read-only enforced at every layer (this is the same
  guarantee `SECURITY_REVIEW.md` and `tests/test_security.py` already verify for the
  chat flow — O4 must be provably consistent with it, verified the same way:
  `git diff --stat -- src/` staying additive-only and the existing security test
  suite still passing).
- **Tests required:** exact match found; no match handled safely; multiple matches
  require owner disambiguation; no Odoo write occurs under any code path (this is
  the single most important test in this phase); existing security suite green.
- **Docker/runtime validation:** live match against real (or realistic mock) Odoo
  data in the existing dev setup.
- **Documentation required:** roadmap status; `docs/TOOLS.md` or `SECURITY_REVIEW.md`
  update if the read-only surface genuinely grows.
- **Stop conditions:** any code path that could write to Odoo — stop immediately,
  this is a hard architectural boundary, not a judgment call.
- **Release impact:** required for Milestone 2.

### O5 — Missing Delivery Proof Detection

- **Goal:** compare expected delivered invoices from Odoo with stored proof records.
- **Operational problem solved:** this becomes the operational replacement for
  manually scrolling WhatsApp to check "did we get a photo for this delivery" — the
  actual business-value payoff of the OCR track.
- **Dependencies:** O4 (matching must exist before "missing" can be defined).
- **Exact scope:** invoices with proof; invoices missing proof; unmatched uploaded
  proofs (a proof that didn't match anything); duplicate proof suspicion (two proofs
  matching the same invoice); date and driver filters.
- **Explicit out of scope:** automatic remediation/nudging (that's adjacent to D8
  notifications or a future phase, not silently folded in here).
- **Likely files/folders:** new owner-facing report page under `app/dashboard/`,
  read-only Odoo query extension (same boundary as O4), `tests/*`.
- **Security requirements:** OWNER-only; read-only Odoo access only.
- **Tests required:** correct classification of proof/no-proof/unmatched/duplicate
  states against controlled fixtures; filters scoped correctly.
- **Docker/runtime validation:** live report against real data.
- **Documentation required:** roadmap status update; this phase likely marks Track 2
  functionally complete, so note that explicitly when it lands.
- **Stop conditions:** standard boundary conditions.
- **Release impact:** completes Milestone 2.

---

## 5. Track 3 — Analytics Module

**Explicit rule: analytics must not be implemented until enough reliable production
data exists.** This track has no committed start date — it is sequenced here for
completeness, not for near-term execution. Do not begin A1 speculatively.

### A1 — Delivery Operations Analytics

- **Goal:** owner-facing operational metrics: daily uploaded count, pending review,
  verified/rejected rates, missing-proof count (once O5 exists), average review
  time, resubmission count (once D7 exists), OCR completion/failure rates (once O2
  exists).
- **Dependencies:** meaningful production usage history (Milestone 1 at minimum;
  several fields depend on O2/O5/D7 already existing).
- **Scope note:** this is aggregation over already-persisted data — no new
  operational write paths, read-only reporting only.

### A2 — Driver Analytics

- **Goal:** uploads by driver, rejection rate, resubmission rate, missing-proof
  assignments (only if a driver-assignment concept exists — it does not today, and
  this phase must not invent one speculatively), trend views.
- **Dependencies:** A1, real multi-driver production history.

Both A1 and A2 follow the standard phase template (§9) when actually planned;
detailed scope is deferred until there's real data to design against, per the
explicit rule above.

---

## 6. Track 4 — Production Infrastructure

Owner: mixed (`apps/web`, `apps/api`, deployment tooling). This track is about
making the *existing* architecture production-grade, not changing what it does.

### P1 — Object Storage and Image Optimization

- **Goal:** move delivery-proof images from the local Docker volume to
  S3-compatible object storage.
- **Preferred path:** local Docker volume (today) → MinIO for production-like
  development → managed S3-compatible storage in cloud. This mirrors exactly the
  migration path `docs/DELIVERY_MANAGEMENT_PLAN.md` §6 already committed to when D3
  chose local storage for the MVP — the `imagePath` field was deliberately named to
  abstract the backend for this reason.
- **Scope:** private objects (never public URLs); signed/access-controlled image
  serving (replacing but functionally matching today's
  `/api/proofs/[id]/image` authorization guarantees); thumbnails; image compression;
  original retention policy; a migration script moving existing volume files to the
  new backend; a rollback path; a backup strategy for the new store.
- **Hard rule carried from D3:** do not store large image blobs in the relational
  database — this was rejected at D3 and remains rejected.
- **Trigger:** D9's pilot storage-usage monitoring, or the same trigger already
  documented in the Delivery plan — the moment more than one `apps/web` instance
  needs to run (ties to P2's trigger too).

### P2 — PostgreSQL Migration

- **Goal:** replace SQLite/libsql for production use.
- **Scope:** schema compatibility audit (the schema has been deliberately kept
  Postgres-portable since the very first migration — strings instead of enums, cuid
  ids, portable DateTime — this phase is where that discipline pays off); migration
  strategy; a test migration using copied real data; index review; connection
  pooling; transaction review; rollback path.
- **Hard rule:** no silent loss of conversations, users, or delivery proofs — this
  migration is the highest-data-risk phase in the entire roadmap and must be treated
  accordingly (dry-run against a copy, verified row counts before/after, never run
  directly against the only copy of production data).
- **Trigger:** same as P1 — horizontal scaling need, or a deliberate pre-launch
  hardening decision for Milestone 3.

### P3 — Backup, Retention, and Recovery

- **Goal:** database backups, image backups, a *tested* restoration procedure (not
  just a backup that's never been restored), retention policy, deletion policy, a
  policy for rejected/replaced images (interacts directly with D7's audit-history
  design — do not delete attempt history without an explicit retention decision),
  disaster recovery runbook.

### P4 — Monitoring and Observability

- **Goal:** structured logs, request correlation, authentication failures, upload
  failures, OCR failures (once Track 2 exists), Odoo matching failures (once O4
  exists), health checks, error reporting, uptime monitoring, storage and database
  alerts.
- **Hard rule:** do not log secrets, passwords, full JWTs, or sensitive invoice
  contents unnecessarily — this extends the same discipline already present in the
  codebase (e.g. `security_audit.log`'s existing careful scoping) to the new
  Delivery/OCR surfaces.

### P5 — Production Deployment

- **Goal:** HTTPS, reverse proxy, secret management (replacing `.env` files — already
  flagged as a known gap in `docs/NEXT_PHASES.md`), non-root containers (already true
  today — verify it survives the P1/P2 migrations), private internal API, production
  environment variables, deployment rollback, domain configuration, production smoke
  tests, an operational runbook.
- **Release gate name: "Production Internal Platform."** This is Milestone 3.

---

## 7. Track 5 — Public SaaS Expansion

**This track is not required for Kaizera internal use.** Everything in this track
exists only if and when a decision is made to sell this platform to other
businesses — a decision this roadmap does not make or assume. `docs/NEXT_PHASES.md`
already lists multi-tenancy, organizations, billing, and admin user-management UI
under "What should NOT be built yet"; this track is where they'd eventually go, not
an instruction to start them.

### S1 — Organizations and Multi-Tenancy

`Organization` model; membership; tenant scoping on every query (not just Delivery —
conversations, users, everything); tenant-aware file storage (P1 must exist first);
tests proving cross-tenant isolation with the same rigor D1.1/D2 proved
cross-driver isolation.

### S2 — Per-Organization Odoo Connections

Encrypted credentials (today there is exactly one Odoo connection, shared,
configured via environment — this phase makes that per-tenant); connection
validation; read-only permissions enforced per tenant; tenant isolation; credential
rotation; audit logs.

### S3 — User Administration

Owner-managed users; driver creation/deactivation via UI (replacing D1's
deliberately UI-less seed-script provisioning); password reset; invitations; role
changes; audit trail. **This must remain separate from the minimal identity
foundation** — D1's explicit design decision was no user-management UI, and that
decision holds until this phase, planned on its own, decides otherwise.

### S4 — Billing and Subscription Plans

Only after: multi-tenancy (S1) exists, real organizations exist, a metering
definition exists, a support process exists, production monitoring (P4) exists.
Scope: plans, limits, subscriptions, invoices, webhook security, cancellation,
failed payment handling.

### S5 — Privacy, Legal, and Data Governance

Terms, privacy notice, image/data retention policy (building on P3), deletion/export
capability, tenant data ownership, regional compliance review.

### S6 — Public Launch

Onboarding, support, documentation, demo tenant, status page, incident response,
launch checklist. **Release gate name: "Public SaaS Launch."** This is Milestone 4.

---

## 8. Release Milestones

### Milestone 1 — Internal Delivery MVP

- **Required completed phases:** D1, D1.1, D2, D3, D4, D5, D6, D6.1, D6.2, D7, D8 (all
  already done), D9.
- **Acceptance criteria:** the D9 acceptance gate in §3 above — drivers upload
  without office assistance, owners review reliably, rejections are correctable,
  no cross-driver leakage, data/files survive restarts, WhatsApp can be retired.
- **Explicitly not required:** OCR (Track 2), analytics (Track 3), object storage or
  Postgres (Track 4), any multi-tenancy (Track 5).

### Milestone 2 — Intelligent Delivery Operations

- **Required completed phases:** Milestone 1, O1, O2, O3, O4, O5.
- **Acceptance criteria:** invoice data is extracted and owner-correctable; extracted
  invoices are matched read-only against Odoo; missing-proof detection replaces
  manual WhatsApp auditing.
- **Explicitly not required:** analytics dashboards (Track 3 can follow but isn't a
  gate), production infrastructure hardening (Track 4), multi-tenancy (Track 5).

### Milestone 3 — Production Internal Platform

- **Required completed phases:** P1, P2, P3, P4, P5 (Track 4 in full). Does not
  require Track 2/3 to be complete — infrastructure hardening can proceed in
  parallel with or after OCR work, since they're independent tracks (Principle 3).
- **Acceptance criteria:** the platform runs on production-grade infrastructure
  (object storage, Postgres, monitoring, backups, HTTPS/deployment) regardless of
  which product tracks (OCR, analytics) are complete.
- **Explicitly not required:** any Track 5 (SaaS) work.

### Milestone 4 — Public Multi-Tenant SaaS

- **Required completed phases:** Milestone 3, S1, S2, S3, S4, S5, S6.
- **Acceptance criteria:** the full S6 launch checklist.
- **Explicitly not required:** nothing — this is the final milestone in this
  roadmap. Anything beyond it is out of scope for this document.

---

## 9. Phase Template

Every future phase in this roadmap (and any not-yet-written phase discovered later)
is planned using this template, matching the planning gate in
`docs/PROJECT_DEVELOPMENT_GUIDE.md` §4:

- **Module owner**
- **Goal**
- **Operational problem solved**
- **Dependencies**
- **Exact scope**
- **Explicit out-of-scope**
- **Likely files/folders**
- **Security requirements**
- **Tests required**
- **Docker/runtime validation**
- **Documentation required**
- **Stop conditions**
- **Release impact**

---

## 10. Priority Recommendation

**Immediate order, reconciled against verified reality (D6.2, D7, and D8 are all
already complete):**

1. ~~D6.2~~ — **already complete** (`e98cd84`).
2. ~~D7 — Rejected Proof Resubmission~~ — **already complete**; see this document's
   D7 section above for what shipped.
3. ~~D8 — Driver In-App Notifications~~ — **already complete**; see this document's
   D8 section above for what shipped.
4. **D9 — Internal Pilot and Operational Validation** (the actual immediate next
   phase)
5. O1 — only after pilot feedback confirms OCR is worth pursuing
6. Continue OCR (O2 onward) only if the pilot confirms it provides meaningful value

**Explicitly stated, as required:** do not let OCR delay replacing the WhatsApp
workflow. Track 1 (D9) is the entire near-term priority; Track 2 does not begin
until Milestone 1 is reached and the pilot has actually confirmed OCR is worth
building, not merely because it was next on a list.

---

## 11. Stop Conditions (apply to every phase in this roadmap)

Future implementation must stop and return to planning if:

- `src/` or `app.py` requires an unexpected change
- `route_query()` or Odoo business logic would be modified unexpectedly
- a phase starts implementing a future module (e.g. O-track work sneaking into a
  D-track phase, or S-track work sneaking into anything before Milestone 3)
- a schema decision threatens audit history (particularly relevant to D7's attempt
  history and P2's migration)
- authorization cannot be enforced server-side
- file persistence is not validated in Docker
- a migration risks data loss
- tests fail
- secrets are detected in a diff
- a major architecture decision appears that was not approved (e.g. O1 concluding
  background workers are required — that conclusion must come back for explicit
  approval before O2 implements it)

---

## Documentation Validation

Performed before this document was committed:

- **Every referenced document exists:** confirmed via directory listing —
  `docs/PROJECT_DEVELOPMENT_GUIDE.md`, `docs/DELIVERY_MANAGEMENT_PLAN.md`,
  `docs/NEXT_PHASES.md`, `docs/SAAS_MIGRATION_PLAN.md`, `docs/API_AUTHENTICATION.md`,
  `docs/AUTH_AND_PERSISTENCE.md` all present.
- **Phase numbering matches real completed history:** cross-checked against
  `git log --oneline` (commits `2f3df70` through `e98cd84`) and
  `apps/web/prisma/migrations/` (five migrations: init, composite index, user
  identity, delivery proof, OCR readiness — consistent with D1/D2/D5's claimed
  schema changes; D3/D4/D6/D6.1/D6.2 correctly added no migrations).
- **Completed work is not listed as future:** D6.2 corrected — the commissioning
  brief for this document listed it as pending; verified complete and moved to the
  Completed section (see the correction note at the top of this file).
- **Future work is not marked completed:** D7 onward carries no completion claim
  anywhere in this document.
- **Cross-references checked:** `docs/PROJECT_DEVELOPMENT_GUIDE.md` §8 Document Map
  and §9 Active Modules updated to point here;
  `docs/DELIVERY_MANAGEMENT_PLAN.md` §9 given a forward cross-reference for D7+.
