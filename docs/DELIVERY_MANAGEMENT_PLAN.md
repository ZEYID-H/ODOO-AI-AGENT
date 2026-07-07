# Delivery Management Module — Plan (Documentation-Only Phase)

**Status:** Planned, not implemented. Nothing in this document exists in code yet.
**Governing documents:** `docs/NEXT_PHASES.md`, `docs/SAAS_MIGRATION_PLAN.md`, and the
project's phase-gate workflow (plan → approval → one module per phase → stop on
architectural surprises). This plan was requested under the name
`docs/PROJECT_DEVELOPMENT_GUIDE.md`; no file by that name exists in the repo, so the
documents above are the effective governing references.

**Supersession note:** `docs/NEXT_PHASES.md` lists "user roles / permissions tiers" and
"admin dashboard" under *What should NOT be built yet*, gated on real user accounts
existing first. This module deliberately pulls both forward — and pulls the real-accounts
prerequisite (NEXT_PHASES item 2) forward with them, as the first phase (D1). That
supersession is approved as part of this plan; `NEXT_PHASES.md` itself is intentionally
left unedited in this documentation-only phase and should be reconciled when D1 lands.

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

**Prerequisite folded into this module (D1):** today the app has exactly one shared
password (`APP_ACCESS_PASSWORD` in `lib/auth-credentials.ts`) producing one synthetic
`personal-user`. A driver cannot "log in and see only a driver portal" if everyone logs
in with the same password. D1 therefore includes a *minimal* real-user credential model:
`username`, `passwordHash`, `role`, `name` on the existing `User` table — which
`prisma/schema.prisma` was explicitly designed to absorb ("swapping in real multi-user
auth later only means adding fields here"). This is the riskiest part of the module and
is scoped first, alone.

**Known limitation to document, not solve:** sessions are stateless JWTs
(`session: { strategy: "jwt" }` in `auth.ts`), so changing or revoking a user's role
does not take effect until their token expires. MVP mitigation: modest session maxAge
and a documented re-login requirement. Token revocation is out of scope.

**Related fix required in D1:** the login rate limiter (`lib/login-rate-limit.ts`) is
currently global. With multiple driver accounts, one driver's failed attempts would lock
out everyone including the owner — it must become per-username.

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

`User` additions (D1, drafted here for completeness): `role`, `username` (unique),
`passwordHash`, `name`. All types stay Postgres-portable (strings, DateTime, cuid ids)
per the schema's existing design contract. `Conversation`/`Message` and
`app/actions/conversations.ts` are not restructured.

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
- Per-username login rate limiting (replacing today's global limiter) so one account's
  failures cannot deny service to others.
- Seed/owner credentials arrive via environment variables (documented in
  `.env.docker.example` with placeholder values only) — never committed.

---

## 8. MVP Scope

**Included:**

- Role foundation (OWNER / DRIVER, minimal real user accounts)
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

**Goal:** Add role support for OWNER and DRIVER, backed by minimal real user accounts.

**Scope:**
- Extend `User` with `role`, `username`, `passwordHash`, `name` (+ migration)
- Username + password login (bcrypt/argon2) replacing the shared password
- Seed owner account from env; minimal mechanism to create driver accounts (seed
  script or owner-only action is acceptable for MVP)
- Role into JWT/session callbacks; `requireRole()` guard
- Protect `/dashboard` from DRIVER
- Create empty `/driver` protected route (placeholder — no uploads yet)
- Owner/admin keeps current dashboard access unchanged
- Per-username login rate limiting
- Owner-gate the existing API-token minting action

**Out of scope:** image upload, DeliveryProof model, OCR, admin review, any driver UI
beyond the placeholder.

**Likely files:**
- `apps/web/prisma/schema.prisma` + migration (User fields only)
- `apps/web/auth.ts`
- `apps/web/lib/auth-credentials.ts`
- `apps/web/lib/login-rate-limit.ts`
- `apps/web/lib/session-guard.ts`
- `apps/web/types/next-auth.d.ts` (session type augmentation)
- `apps/web/app/dashboard/page.tsx`
- `apps/web/app/driver/page.tsx` + `layout.tsx` (new)
- `apps/web/app/login/page.tsx`, `apps/web/components/LoginForm.tsx` (username field)
- `apps/web/app/page.tsx` (role-aware root redirect)
- `apps/web/.env.docker.example`
- `apps/web/tests/*` (updated: auth-credentials, login-rate-limit, session-guard,
  LoginForm, login-action; new: role-guard)

**Validation:**
- OWNER can access dashboard (full existing flow unchanged end-to-end)
- DRIVER cannot access dashboard (direct URL → redirect, no dashboard bytes served)
- DRIVER can access `/driver`
- DRIVER invoking an owner-only server action directly → rejected
- Unauthenticated users redirect to login
- `npm run lint` / `build` / `test`
- Docker runtime login check for both roles

**Stop condition:** If role handling requires a major auth redesign (e.g. Auth.js
forces a database adapter or changes beyond `auth.ts`/`auth-credentials.ts`), stop and
ask before proceeding.

---

### D2 — Delivery Proof Data Model

**Goal:** Add persistence for delivery proof metadata (before any file handling).

**Scope:**
- `DeliveryProof` Prisma model (§5) + migration
- Basic server actions: create (metadata-only), list (driver-scoped and owner-scoped),
  update status (verify/reject)
- Ownership checks inside every action

**Out of scope:** actual image upload (storage not wired yet — `imagePath` stays
nullable until D3), OCR, Odoo matching, any UI change.

**Likely files:**
- `apps/web/prisma/schema.prisma` + migration
- `apps/web/app/actions/delivery-proofs.ts` (new)
- `apps/web/tests/delivery-proofs.test.ts` (new)

**Validation:**
- DRIVER can create own proof metadata
- DRIVER cannot read others' proofs
- OWNER can list all
- OWNER can verify/reject; DRIVER cannot
- `prisma migrate` / `prisma generate` clean
- `npm test`

**Stop condition:** If the schema conflicts with future object-storage needs or
requires anything SQLite-specific / non-Postgres-portable, stop and document before
continuing.

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
- Validate per-username rate limiting inside Docker
- Validate seed-owner env wiring from `.env.docker`

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
