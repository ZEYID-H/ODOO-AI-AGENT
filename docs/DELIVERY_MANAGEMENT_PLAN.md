# Delivery Management Module — Plan (Documentation-Only Phase)

**Status:** Planned, not implemented. Nothing in this document exists in code yet.
**Governing document:** `docs/PROJECT_DEVELOPMENT_GUIDE.md` — the single source of
truth for architecture boundaries, module ownership, the planning-gate workflow, the
MVP First principle, validation standards, and the phase report format. This plan
applies that guide to one module; where anything here conflicts with the guide, the
guide wins.

**Supersession note:** `docs/NEXT_PHASES.md` lists "user roles / permissions tiers" and
"admin dashboard" under *What should NOT be built yet*. This module supersedes those
entries with approval — but in the smallest possible increments: D1 introduces roles as
a session-level concept only (no new account system, no schema change), and real
per-driver accounts arrive only at the phase where data ownership actually requires
them (D2). `NEXT_PHASES.md` is left unedited as history; governance now lives in the
guide (see its Document Map).

---

## 1. Module Overview

**Module name:** Delivery Management

**Purpose:** Drivers currently send delivered-invoice photos through WhatsApp every day.
This causes confusion, missing proof, hard tracking, and a poor review workflow: photos
are scattered across chats, there is no status (verified vs. disputed), no association
with drivers or invoices, and no audit trail.

**Goal:** Add a Driver Portal inside the existing SaaS app (`apps/web`) where drivers see
*only* a delivery-proof upload area, while owner/admin users keep full access to the
existing dashboard plus a new Delivery Proof management page.

**This is not a separate website.** It is a role-restricted module inside the existing
platform, reusing the existing Auth.js session, Prisma persistence, and Docker volume.

**Module owner:** `apps/web` (the Next.js SaaS app). Delivery proof is an
authentication + UI + persistence feature; every capability it needs already lives in
`apps/web` — Auth.js sessions (`auth.ts`), the server-side page gate
(`lib/session-guard.ts`), Prisma/SQLite persistence (`prisma/schema.prisma`), and the
Docker volume (`conversations-data:/data`). It involves zero AI routing, zero Odoo data,
and zero business analytics, so `src/`, `app.py`, and `apps/api` do not participate.

---

## MVP First (guiding principle for every Delivery phase)

Every Delivery phase solves **one operational problem only**. The operational problem
of this module is: *delivered-invoice photos are scattered across WhatsApp with no
status, no ownership, and no review trail.* Nothing gets built that doesn't directly
serve that problem.

- Never build future architecture before it becomes necessary. No user-management
  system, no organizations, no permission matrix, no invitation flows, no speculative
  schema fields "for later."
- Prefer **evolutionary architecture over speculative architecture**: each phase makes
  the smallest change that solves its problem while not blocking the next phase.
  "Doesn't block later" is the bar — not "already supports later."
- Concretely for this module: roles arrive before accounts (D1 needs to *gate routes*,
  not manage users); per-driver identity arrives only when proof ownership needs it
  (D2); storage stays on the existing volume until scale forces object storage;
  OCR stays on paper (D6) until the manual workflow proves what extraction is worth.
- If a phase's scope grows a second problem, split it — per the governing guide's
  planning gate.

---

## 2. User Roles

Initial roles (stored as portable strings, matching the schema's documented no-enum
convention):

**OWNER**
- Full dashboard access
- AI Assistant
- Reports
- Delivery proof management (list, filter, view, verify, reject)
- Driver management (later)
- Settings (later)

**DRIVER**
- Access only to `/driver`
- Upload delivery invoice photos
- View their own uploaded proofs for today / recent days
- Logout
- Must NOT access: dashboard, AI Assistant, reports, customers, products, financial
  data, or any admin pages

**Authorization must be server-side.** Client-side hiding (e.g. omitting sidebar items)
is UX, never security. Every protected page calls a server-side role guard before
rendering (the established `requireSession()` pattern in `lib/session-guard.ts`,
extended to `requireRole()`), and every server action independently re-checks role and
ownership — server actions are directly invokable endpoints, so page gates alone protect
nothing.

**How roles arrive without a new account system (evolutionary, per MVP First):**
today the app has exactly one shared password (`APP_ACCESS_PASSWORD` in
`lib/auth-credentials.ts`) producing one synthetic `personal-user`. D1 extends this
pattern minimally instead of replacing it: a **second shared access password**
(`DRIVER_ACCESS_PASSWORD`) maps to a synthetic driver identity with role `DRIVER`,
while the existing password keeps mapping to the owner identity with role `OWNER`.
The login form stays exactly as it is (one password field — no username, no rewrite),
Auth.js wiring stays as it is, and **no database change is needed in D1 at all**: the
role is decided at login and carried in the JWT/session callbacks that `auth.ts` was
explicitly designed to absorb.

**Where per-driver identity arrives instead:** a shared driver password means drivers
are indistinguishable from each other — fine for D1 (which only gates routes), not
fine once proofs need an owner ("driver sees only their own uploads"). That boundary
is `DeliveryProof.driverId` in D2, so D2 is where the *smallest sufficient* per-driver
identity step is taken (expected: the existing `User` model gains `role` plus minimal
credential fields — the schema was designed so this is additive). D2 decides that
design; D1 deliberately does not.

**Known limitation to document, not solve:** sessions are stateless JWTs
(`session: { strategy: "jwt" }` in `auth.ts`), so changing or revoking a user's role
does not take effect until their token expires. MVP mitigation: modest session maxAge
and a documented re-login requirement. Token revocation is out of scope.

**Known limitation (deferred):** the login rate limiter (`lib/login-rate-limit.ts`)
is global. With two shared passwords this matches today's behavior; once real
per-driver accounts exist (D2+), it should become per-username so one driver's failed
attempts can't lock out everyone. Deferred to the phase that introduces those
accounts.

---

## 3. Target Navigation

**OWNER / ADMIN navigation** (existing sidebar, extended):

- Dashboard
- AI Assistant
- Conversations
- Delivery Proof
- Drivers *(later — placeholder nav only when it exists)*
- Settings *(later)*

**DRIVER navigation** (minimal, own layout — not the dashboard sidebar):

- Upload Delivery Proof
- My Uploads
- Logout

Drivers get a separate route tree (`app/driver/`) with its own minimal server-gated
layout. They never receive dashboard markup at all — no full sidebar unless a real need
appears. The driver UI is mobile-first and extremely simple: drivers use phones in the
field, so large touch targets, camera capture, and upload progress matter more than
visual polish.

---

## 4. Core Architecture

Reuse the existing architecture unchanged:

```
Browser
  ↓
Next.js Web App (apps/web)
  ↓
Auth.js Session (JWT, http-only cookie)
  ↓
Prisma Persistence (SQLite now, Postgres-portable)
  ↓
Docker Volume (conversations-data:/data)
```

Delivery proof upload flow (entirely inside the `web` container):

```
Driver Browser (mobile)
  ↓
/driver (server-gated page)
  ↓
Next.js Server Action / Route Handler
  ↓
Role check (DRIVER, from server session — never from client input)
  ↓
File validation (size cap, MIME + magic bytes, allowlist)
  ↓
Persistent storage (/data/uploads/<generated-name>)
  ↓
DeliveryProof database record (Prisma)
```

Hard boundaries:

- Do NOT call Odoo directly from Next.js.
- Do NOT involve `route_query()` in the upload flow.
- Do NOT involve FastAPI (`apps/api`) unless future AI/OCR genuinely needs it — and
  that would be a separate approved phase, not part of this MVP.
- The Phase 10 browser↔api token flow (`lib/api-token.ts`, `lib/api.ts`) is untouched;
  drivers are never issued an API token (the token-minting action becomes OWNER-only).

Image serving is authenticated: files live under `/data/uploads` (outside the web
root, never in `public/`) and are served only through a role-checked route handler
(driver sees only their own images; owner sees all).

---

## 5. Data Model Draft

Draft only — **do not implement in this documentation phase.**

```
DeliveryProof
- id              (cuid)
- invoiceNumber   (optional at first; required later if workflow demands it)
- customerName    (optional)
- notes           (optional)
- imagePath       (or objectKey — named to abstract the storage backend)
- mimeType
- sizeBytes
- status          "PENDING" | "VERIFIED" | "REJECTED"  (string, Postgres-portable)
- rejectionReason (optional)
- uploadedAt
- verifiedAt      (optional)
- driverId        (FK → User)
- verifiedById    (optional FK → User)
- createdAt
- updatedAt
```

Relationships:
- `User` (DRIVER) → many `DeliveryProof` records (`driverId`)
- `User` (OWNER) → can verify/reject records (`verifiedById`)

Indexes:
- `driverId + uploadedAt` (driver's own recent uploads — the hot query)
- `status + uploadedAt` (admin review queue)
- `invoiceNumber` (admin lookup)
- `uploadedAt` (date filtering)

`User` additions: **none in D1** (roles are session-level; no schema change). At D2,
when `DeliveryProof.driverId` makes per-driver identity necessary, the existing `User`
model gains the smallest sufficient fields — expected `role` plus minimal credential
fields, decided and approved at D2. All types stay Postgres-portable (strings,
DateTime, cuid ids) per the schema's existing design contract. `Conversation`/`Message`
and `app/actions/conversations.ts` are not restructured, ever, by this module.

---

## 6. Image Storage Strategy

Three options compared:

**A) Local filesystem volume**
- Pros: simplest for the current Docker setup; no new service; fast to implement; the
  named volume (`conversations-data:/data`) already exists, already survives restarts,
  and already holds the SQLite DB — images beside it share one backup/persistence story.
- Cons: not ideal for multi-server production; requires a backup strategy; later
  migration to object storage needed if the deployment ever scales horizontally.

**B) Database blob**
- Pros: all data in one place.
- Cons: bad for large images; SQLite with multi-MB blobs degrades every query in the
  same file; database grows quickly; worse performance; makes the already-planned
  Postgres migration heavier. Not recommended.

**C) Object storage / MinIO / S3**
- Pros: best long-term; scalable; clean production path.
- Cons: more moving parts (a third container), more configuration (credentials,
  presigned URLs, lifecycle policies), more complexity now — for a stack that is
  documented as local-only, single-instance (`docs/DOCKER_SAAS_STACK.md`,
  loopback-bound ports).

**Recommendation for MVP: A — local filesystem Docker volume.**

Reason: the project is still internal/personal and already uses Docker volumes
successfully. A local volume is the fastest *safe* MVP: zero new services, zero new
secrets, zero new failure modes. The schema is designed around `imagePath`/`objectKey`
so a later move to object storage is a data migration, not a redesign.

**Future migration path:** local volume → MinIO/S3-compatible object storage. The
trigger for that migration is the same as for the Postgres migration: the moment more
than one `apps/web` instance runs, or the deployment leaves a single host.

Docker note: the web container runs as non-root with `cap_drop: ALL`, so
`/data/uploads` must be created with correct ownership in `docker-entrypoint.sh` (the
same pattern as the SQLite file) — validated explicitly in D5.

---

## 7. Security Requirements

All of the following are hard requirements, not aspirations:

- Server-side role checks on every protected page (`requireRole()` on the
  `requireSession()` pattern) and inside every server action independently.
- Drivers cannot access `/dashboard` — the request is redirected server-side; no
  dashboard bytes are ever sent to a driver session.
- Drivers cannot access admin delivery pages (`/dashboard/delivery-proof`).
- Drivers can only see their own uploads — every list query and the image-serving
  route filter by the session's user id.
- Owners can see all delivery proofs.
- File type validation: allowlist (JPEG/PNG/WebP), checked by MIME *and* magic bytes,
  never by filename extension alone.
- File size limit: hard server-side cap regardless of any client-side handling.
  (Note: phone photos run 3–12 MB and Next.js Server Actions default to a ~1 MB body
  limit — D3 decides between raising `serverActions.bodySizeLimit` and using a route
  handler, plus optional client-side downscaling. iPhone HEIC is handled by either
  client-side re-encode or explicit rejection with a clear message.)
- Safe filenames: server-generated (cuid-based); client-provided filenames are never
  used in paths — eliminates path traversal by construction.
- No direct public unrestricted file paths: images live outside the web root and are
  served only through an authenticated, role-checked route handler with non-guessable
  ids.
- No secrets in frontend code or in the client bundle.
- No trust in client-provided `userId` — ever. All user identity comes from the
  server session (`auth()`), exactly as `app/actions/conversations.ts` already does.
- Per-username login rate limiting once real per-driver accounts exist (D2+), so one
  account's failures cannot deny service to others; until then the existing global
  limiter's behavior is unchanged.
- Access credentials arrive via environment variables (documented in
  `.env.docker.example` with placeholder values only) — never committed.

---

## 8. MVP Scope

**Included:**

- Role foundation (OWNER / DRIVER — session-level in D1; minimal per-driver identity
  when D2's data ownership requires it)
- DRIVER route (`/driver`) with server-side gating
- Driver-only, mobile-first upload page
- Upload invoice photo with validation
- Store image on the persistent Docker volume
- Save metadata (`DeliveryProof` record)
- Driver can view own uploads (today / recent)
- Owner can view all uploaded proofs
- Owner can verify/reject a proof (with rejection reason)
- Basic filters: date, status, driver, invoice number
- Tests (unit tests for guards, validation, ownership; updated auth tests)
- Docker validation (persistence across restart, role gates in the real stack)

**Out of scope for MVP:**

- OCR
- Automatic invoice extraction
- Odoo invoice matching
- GPS / location capture
- Customer signature
- WhatsApp integration
- Email notifications
- Advanced analytics
- Driver performance scoring
- Multi-tenant driver isolation
- Mobile app (native)
- Offline mode
- Password reset / self-registration flows
- Token revocation / live role changes (JWT staleness documented instead)

---

## 9. Phased Implementation Roadmap

One phase per implementation session; each phase ends with the validation checklist
(§11) and the report format (§12); no phase begins without the previous one committed
and green.

### D1 — Role Foundation

**Goal:** Introduce OWNER and DRIVER roles only — the minimum role foundation the
Driver Portal requires. D1 is NOT a user-management phase.

**Scope (smallest safe architectural change):**
- Add role support: `DRIVER_ACCESS_PASSWORD` env var; `attemptLogin()` maps the
  existing password → role `OWNER`, the new password → role `DRIVER` (existing
  Auth.js foundation extended, not replaced; login form and flow unchanged)
- Role into the existing JWT/session callbacks; `requireRole()` alongside
  `requireSession()`
- Protect `/dashboard` from DRIVER (server-side redirect)
- Create protected `/driver` page (placeholder with logout — no uploads yet)
- Redirect DRIVER away from admin pages generally: role-aware post-login/root
  redirect, and a role check on the existing API-token minting action so a DRIVER
  session cannot mint a token and reach the AI endpoints
- **No Prisma change. No migration. No login rewrite. No new accounts.**

**Out of scope:** upload, DeliveryProof model, OCR, user management, organizations,
permissions matrix, admin UI, analytics, per-driver identity (D2), password reset,
profile management, rate-limiter changes.

**Likely files (all in `apps/web`):**
- `auth.ts` (role in the two existing callbacks)
- `lib/auth-credentials.ts` (second password → role mapping; same pure-function shape)
- `lib/session-guard.ts` (`requireRole()`)
- `types/next-auth.d.ts` (session type gains `role`)
- `app/dashboard/page.tsx` (guard swap: `requireRole("OWNER")`)
- `app/driver/page.tsx` + `layout.tsx` (new, minimal)
- `app/page.tsx` (role-aware redirect)
- `.env.docker.example` (placeholder for the new env var)
- `tests/*` (updated: auth-credentials, session-guard; new: role-guard)

**Validation:**
- OWNER can access dashboard (full existing flow unchanged end-to-end)
- DRIVER cannot access dashboard (direct URL → redirect, no dashboard bytes served)
- DRIVER can access `/driver`; unauthenticated `/driver` request → login
- DRIVER cannot mint an API token
- Unauthenticated users redirect to login
- `npm run lint` / `build` / `test`
- Docker runtime login check for both roles

**Stop condition:** If role handling turns out to require a schema change, a login
rewrite, or any auth redesign beyond the files above, stop and ask before proceeding.

---

### D2 — Delivery Proof Data Model

**Goal:** Add persistence for delivery proof metadata (before any file handling) —
including the smallest per-driver identity step that proof ownership forces.

**Scope:**
- `DeliveryProof` Prisma model (§5) + migration
- **Minimal per-driver identity** (moved here from D1, because `driverId` is the
  first thing that actually needs it): the existing `User` model gains a `role`
  field plus the smallest credential mechanism that lets individual drivers be told
  apart — expected `username` + `passwordHash`, decided and approved at this phase's
  own planning gate. Not a user-management system: no invitations, no reset, no
  profiles, no admin UI. If D2's gate concludes ownership can be established even
  more simply, prefer that.
- Basic server actions: create (metadata-only), list (driver-scoped and owner-scoped),
  update status (verify/reject)
- Ownership checks inside every action

**Out of scope:** actual image upload (storage not wired yet — `imagePath` stays
nullable until D3), OCR, Odoo matching, any UI change beyond what login strictly
needs if credentials change shape, user management of any kind.

**Likely files:**
- `apps/web/prisma/schema.prisma` + migration
- `apps/web/lib/auth-credentials.ts` (only if the credential mechanism changes here)
- `apps/web/lib/login-rate-limit.ts` (per-username keying arrives with real accounts)
- `apps/web/app/actions/delivery-proofs.ts` (new)
- `apps/web/tests/delivery-proofs.test.ts` (new)

**Validation:**
- DRIVER can create own proof metadata
- DRIVER cannot read others' proofs
- OWNER can list all
- OWNER can verify/reject; DRIVER cannot
- `prisma migrate` / `prisma generate` clean
- `npm test`

**Stop condition:** If the schema conflicts with future object-storage needs, requires
anything SQLite-specific / non-Postgres-portable, or the identity step grows beyond
"User gains role + minimal credentials," stop and document before continuing.

---

### D3 — Driver Upload MVP

**Goal:** Allow drivers to upload invoice photos from a phone.

**Scope:**
- Mobile-first `/driver` upload form (`accept="image/*" capture="environment"`,
  upload progress)
- Server-side file validation (size cap, MIME + magic bytes, allowlist)
- Image saved to the persistent Docker volume (`/data/uploads/<cuid>.<ext>`)
- `DeliveryProof` record linked via `imagePath`
- Authenticated image-serving route handler (driver: own only; owner: all)
- Driver sees own recent uploads with status badges
- Upload transport decision made and documented here (Server Action with raised
  `bodySizeLimit` vs. route handler; client-side compression if needed)

**Out of scope:** OCR, image compression beyond what upload limits require, admin
gallery polish, editing/deleting proofs, multiple images per proof, EXIF processing.

**Likely files:**
- `apps/web/app/driver/page.tsx`
- `apps/web/components/DriverUploadForm.tsx` (new)
- `apps/web/app/actions/delivery-proofs.ts`
- `apps/web/lib/file-storage.ts` (new — validation, safe names, volume writes)
- `apps/web/app/api/proofs/[id]/image/route.ts` (new — authenticated serving)
- `apps/web/next.config.ts` (only if `bodySizeLimit` route is chosen)
- `apps/web/docker-entrypoint.sh` (ensure `/data/uploads` exists, non-root perms)
- `docker-compose.saas.yml` (expected: no change — reuses `conversations-data`)
- `apps/web/Dockerfile` (only if needed for permissions)
- `apps/web/tests/*` (new: file-storage validation, image-route auth)

**Validation:**
- Upload valid image (real phone browser against the dev server)
- Reject invalid type (including spoofed MIME)
- Reject oversized file
- DRIVER sees only own uploads; driver B cannot fetch driver A's image URL;
  unauthenticated image URL → 401/redirect
- Persistence across container restart (Docker volume survives)

**Stop condition:** If the local volume path is unsafe or inaccessible in Docker under
the non-root / `cap_drop: ALL` constraints, or if upload limits force an `apps/api`
endpoint (a boundary change), stop and ask.

---

### D4 — Admin Review Page

**Goal:** Allow owner/admin to review delivery proofs.

**Scope:**
- `/dashboard/delivery-proof` admin page (owner-gated)
- List proofs; filter by date / status / driver / invoice number
- View full-size image
- Verify / reject with rejection reason (`verifiedAt`, `verifiedById` set)
- Sidebar gains the "Delivery Proof" nav item
- Status visible to the driver on their own list

**Out of scope:** OCR, analytics, notifications, bulk actions, pagination beyond a
simple cap (noted as future work, like the conversations sidebar).

**Likely files:**
- `apps/web/app/dashboard/delivery-proof/page.tsx` (new)
- `apps/web/components/DeliveryProofTable.tsx` (new)
- `apps/web/components/DeliveryProofViewer.tsx` (new)
- `apps/web/components/Sidebar.tsx`
- `apps/web/app/actions/delivery-proofs.ts`
- `apps/web/tests/*`

**Validation:**
- OWNER can see all proofs; filters work
- DRIVER cannot access the admin review page (server-side redirect)
- Verify/reject updates status; driver sees the updated status
- `npm run lint` / `build` / `test`
- Docker runtime validation of the full driver→owner loop

**Stop condition:** If admin navigation requires a large layout rewrite, stop and ask.

---

### D5 — Docker Runtime Validation

**Goal:** Validate delivery upload and review in the real containerized stack.

**Scope:**
- `docker compose -f docker-compose.saas.yml build` / `up`
- Volume persistence: upload an image → restart the web container
  (`down` without `-v`, then `up`) → confirm image and DB record remain
- Validate role gates against the running containers (driver blocked from
  `/dashboard`, from raw owner server-action calls, and from others' image URLs)
- Validate login rate limiting inside Docker (per-username if D2 introduced it)
- Validate role/credential env wiring from `.env.docker`

**Out of scope:** deployment to cloud; any new feature code (only fixes for issues
this validation surfaces, staying within Module D files).

**Validation:**
- Docker build; Docker up
- Login as OWNER; login as DRIVER
- Driver upload; admin review
- Restart persistence confirmed
- No secrets committed (`git diff` review before commit)

**Stop condition:** If runtime validation fails, do not commit. If persistence or
permissions demand a compose architecture change (new volume topology, running as
root, capability re-adds), stop and ask.

---

### D6 — OCR Planning Only

**Goal:** Plan future OCR without implementing it.

**Scope (documentation only):**
- Document extraction goals: invoice number, customer, date
- Confidence score design
- Manual correction flow for low-confidence extractions
- Odoo matching strategy — explicitly through the existing *read-only* gateway,
  never granting write access

**Out of scope:** OCR implementation, AI model selection, Odoo writes, any schema
field added "for OCR later."

**Validation:** documentation review only.

**Stop condition:** If OCR becomes necessary for MVP, explicitly ask before
implementing anything.

---

## 10. Future OCR Design

OCR is kept separate from Delivery Upload by design — the upload MVP stores the
original image untouched plus metadata, which is exactly what a future OCR stage needs
as input. Nothing in the MVP schema blocks it.

Future flow:

```
uploaded image
  ↓
OCR extraction (background job or on-review — decided in D6's doc)
  ↓
confidence score
  ↓
manual correction if low confidence
  ↓
Odoo invoice matching (existing read-only gateway only)
  ↓
delivery proof linked to invoice
```

Candidate approaches to evaluate in D6: vision-capable LLM call vs. dedicated OCR
library vs. Odoo-side matching on extracted text. Schema fields it would add later:
`extractedText`, `matchedInvoiceId`, `extractionConfidence`.

**Do not mix OCR into the initial upload MVP.**

---

## 11. Validation Checklist For Delivery Phases

Run for every phase (skip categories a phase demonstrably doesn't touch, and say so in
the phase report):

**Frontend (`apps/web`):**
- `npm run lint`
- `npm run build`
- `npm run test`

**Backend/API (must stay green *unchanged* — these prove the boundary held):**
- `python -m pytest apps/api/tests -v`
- `python -m pytest tests/`
- `python -m py_compile app.py apps/api/main.py`

**Prisma (phases with schema changes):**
- `prisma generate`
- `prisma migrate status`
- Migration tested against a fresh database

**Docker (D3+, and D1's login check):**
- `docker compose -f docker-compose.saas.yml build`
- `docker compose -f docker-compose.saas.yml up`
- Validate login (both roles)
- Validate role gates
- Validate upload
- Validate admin review
- Validate persistence across restart

**Git (every phase):**
- `git status --short`
- `git diff --stat -- src/ app.py apps/api/main.py apps/api/schemas.py`
  (must be empty — the untouchable boundary)
- Confirm no secrets committed (env examples contain placeholders only)

**Files that must remain untouched across all of Module D:**
- `src/` — all of it: AI tools (`src/tools/`), agent router including
  `route_query()` (`src/agent/`), Odoo gateway (`src/services/`), formatting,
  mock data
- `app.py` (Streamlit UI)
- `apps/api/` business logic (`main.py`, `auth.py`, `schemas.py` — no new endpoints)
- `apps/web/lib/api.ts`, `apps/web/lib/api-token.ts` (Phase 10 token flow;
  D1 only owner-gates the minting action)
- `Conversation`/`Message` models and `app/actions/conversations.ts`
- `docker-compose.yml`, root `Dockerfile`, root `tests/` (Streamlit/pytest stack)

---

## 12. Final Report Format For Each Delivery Phase

Each phase must end with a report containing:

- Phase completed (name + one-line outcome)
- Module owner
- Files created
- Files modified
- Files NOT touched (explicit confirmation of the §11 untouchable list)
- Role/security behavior (what was verified, how)
- Storage behavior, if applicable
- Validation results (each checklist item: pass/fail/skipped-with-reason)
- Docker results, if applicable
- Known issues / accepted limitations
- Git commit hash
- Safe to continue: yes/no (+ what the next phase would be)

No phase is "done" without this report, and no next phase starts without explicit
approval of it.
