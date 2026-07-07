# API Authentication — the apps/web ↔ apps/api Trust Boundary

**Phase 10.** Before this phase, `apps/api` trusted every request that
could reach it on the network — no identity check of any kind. This was a
known, explicitly documented gap (Phase 9 audit finding H7): `apps/web`'s
Auth.js login was the *only* access control anywhere in the system, and
`apps/api` itself had no concept of "who is asking." This document
describes what replaced that: a signed, short-lived, cryptographically
verified token attached to every sensitive request.

Related docs: [`AUTH_AND_PERSISTENCE.md`](AUTH_AND_PERSISTENCE.md) (the
user-facing Auth.js login this token flow is downstream of),
[`API_CONTRACT.md`](API_CONTRACT.md) (per-endpoint auth requirements).

---

## Architecture

```
Browser                          Next.js (apps/web)              FastAPI (apps/api)
   │                                    │                               │
   │  1. already has an                │                               │
   │     Auth.js session cookie        │                               │
   │                                    │                               │
   │  2. calls chat()/listTools()      │                               │
   │     (lib/api.ts) ──────────────►  │                               │
   │                                    │  3. getApiToken()             │
   │                                    │     Server Action:            │
   │                                    │     - re-derives user id      │
   │                                    │       from the REAL session   │
   │                                    │       (auth()), never a       │
   │                                    │       client-supplied one     │
   │                                    │     - signs a short-lived     │
   │                                    │       JWT (mintApiToken,      │
   │                                    │       lib/api-token.ts)       │
   │  ◄─────────── 4. token ───────────┤                               │
   │                                    │                               │
   │  5. attaches it as                │                               │
   │     Authorization: Bearer <jwt>   │                               │
   │     and calls apps/api directly ──┼─────────────────────────────► │
   │                                    │                               │  6. require_auth
   │                                    │                               │     dependency
   │                                    │                               │     (apps/api/auth.py):
   │                                    │                               │     verifies signature,
   │                                    │                               │     expiry, issuer,
   │                                    │                               │     audience — 401 on
   │                                    │                               │     any failure
   │                                    │                               │
   │                                    │                               │  7. only on success:
   │                                    │                               │     route_query()
   │  ◄─────────────────────────── 8. response ─────────────────────── │
```

**Why the token still transits the browser** (steps 4→5): `lib/api.ts`'s
`chat()`/`listTools()` are called from Client Components and fetch
`apps/api` directly from the browser (established since Phase 8C — see
`docs/DOCKER_SAAS_STACK.md`'s networking notes on why browser-side calls
need `apps/api`'s published host port, not Docker's internal DNS).
Rewriting that into a full server-side proxy was deliberately out of scope
for this phase (`docs/AUDIT_PHASE_9.md`'s recommendation was "attach
credentials when calling FastAPI," not "stop calling it directly") — the
signing secret itself never reaches the browser (steps 2–4 all run
server-side, inside the Server Action), only a token that's short-lived
and scoped to nothing but "call `apps/api` as this user, for the next 5
minutes." See **Threat model** below for what this does and doesn't
protect against.

---

## Token format

A standard compact JWS (JSON Web Token), signed with HMAC-SHA256.

**Claims:**

| Claim | Value | Purpose |
|---|---|---|
| `sub` | The Auth.js session's user id (today, always the single synthetic `"personal-user"` account — see `AUTH_AND_PERSISTENCE.md`) | Identifies the caller. `apps/api` never trusts a user id from anywhere else. |
| `iss` | `"odoo-ai-agent-web"` | Identifies which service issued the token. |
| `aud` | `"odoo-ai-agent-api"` | Identifies which service the token is *for*. `apps/api` rejects any token not addressed to it — defense-in-depth against a token minted for some other purpose ever being accepted here, even if it happened to share the same secret. |
| `iat` | Issued-at timestamp | Standard JWT claim. |
| `exp` | Issued-at + 5 minutes | See **Token lifetime** below. |

**Signing algorithm: HS256 (HMAC-SHA256).** A symmetric algorithm was
chosen deliberately over an asymmetric one (RS256/ES256 + a JWKS
endpoint): `apps/web` and `apps/api` are two halves of the *same*
deployment, built and operated together, with no third-party consumers of
either token. A shared secret is simpler to configure and reason about,
and avoids standing up key-serving infrastructure (a JWKS endpoint, public
key distribution) that would add real operational surface for no benefit
in this topology. If a genuine third party ever needs to verify these
tokens independently, that's the point to revisit this choice — not
before.

## Token lifetime

**5 minutes.** Chosen because:

- A fresh token is minted **per request** (`getApiToken()` runs on every
  `chat()`/`listTools()` call — see `lib/api.ts`), not cached and reused,
  so there's no session-length UX tradeoff to weigh against a short
  lifetime — a long chat session never needs a "refresh" step, because
  every single request already gets a brand new token.
- Short lifetime limits the window a token is useful for if it were ever
  intercepted (it does transit through the browser — see **Threat model**).
- 5 minutes is comfortably longer than any realistic request latency
  (including OpenAI round trips), so clock skew between containers isn't a
  practical concern.

## Key management

`API_AUTH_SECRET` — a single shared secret, required in **both**
`apps/web` and `apps/api`'s environment (see `.env.example`,
`apps/web/.env.local.example`). Generate with:

```bash
openssl rand -base64 32
```

32+ bytes, matching HMAC-SHA256's recommended minimum key length (RFC
7518 §3.2) — PyJWT emits `InsecureKeyLengthWarning` below that. **Never
reuse `AUTH_SECRET`** (Auth.js's own session-cookie signing key) for this
— they protect different trust boundaries (a browser's session cookie vs.
an inter-service call) and should be independently rotatable; conflating
them means rotating one always means rotating both, and a compromise of
either secret's use case leaks into the other's blast radius for no
reason.

**Both services fail closed if unconfigured** — this is not "auth is
optional if you forget to set the secret":
- `apps/web`: `mintApiToken()` throws immediately rather than signing with
  an empty/undefined key (`lib/api-token.ts`).
- `apps/api`: `require_auth()` rejects every request with 401 rather than
  skipping verification (`apps/api/auth.py`).

**Docker Compose**: set `API_AUTH_SECRET` once, in the repo-root `.env` —
`docker-compose.saas.yml` injects that same value into both containers
(`api` via its existing `env_file: .env`; `web` via explicit variable
substitution, `${API_AUTH_SECRET}`, which Compose reads from the same root
`.env` automatically). One value, one place to set or rotate it, not two
files to keep in sync by hand.

## Rotation strategy (future — not implemented)

Rotating `API_AUTH_SECRET` today means: update it in both services'
config and restart both — a brief window exists where already-issued
tokens signed with the old secret would fail verification against the
new one. Given the 5-minute token lifetime, that window is short and
self-healing (any in-flight token simply expires and the next request
mints a fresh one against the new secret), but it is a real, if brief,
service disruption.

A proper rotation scheme, if/when this needs to happen without any
disruption, would look like:

1. Support **two active secrets** simultaneously in `require_auth()` —
   try the current secret, fall back to the previous one, for a
   transition window.
2. Deploy the new secret to `apps/api` first (it now accepts both old and
   new).
3. Deploy the new secret to `apps/web` (it now signs with the new one
   exclusively).
4. After one full token lifetime (5 minutes) with no traffic using the old
   secret, remove it from `apps/api`.

Not implemented now because: no rotation has ever happened in this
project's lifetime, the current single-operator deployment model doesn't
need zero-downtime rotation, and the short token lifetime already makes an
un-graceful rotation cheap (worst case: a few failed requests for well
under 5 minutes, self-resolving with no manual intervention). Revisit if
this stack is ever deployed somewhere a multi-minute auth hiccup matters.

---

## Threat model

**What this defends against**: any caller that can reach `apps/api` on
the network but does *not* possess a validly-signed, non-expired,
correctly-addressed token — which, before this phase, was sufficient to
call `/chat` (a real OpenAI request) or `/tools`. After this phase, a raw
`curl` to either endpoint gets a 401.

**What this does *not* defend against**, stated plainly rather than
implied:

- **The token transits the browser.** Since `lib/api.ts` calls `apps/api`
  directly from client-side JavaScript, the token is visible in the
  browser's Network tab and to anything with script-execution access to
  the page (e.g. an XSS vector, if one existed — this codebase has none
  today; verified in `docs/AUDIT_PHASE_9.md`: no `dangerouslySetInnerHTML`,
  no `rehype-raw`, markdown rendering can't inject HTML/JS). A 5-minute
  lifetime bounds how long a captured token would remain useful, but it
  is not zero exposure.
- **`apps/api` still has no *user-level* authorization model** — every
  valid token, today, asserts the same single `"personal-user"` identity,
  because that's the only identity Auth.js can issue right now (see
  `AUTH_AND_PERSISTENCE.md`). This phase establishes *authentication*
  (verified identity) as the objective explicitly stated; *authorization*
  distinctions (this user can do X, that user can't) have nothing to
  attach to yet — see **Compatibility with future multi-user/roles**
  below for why that's still a small, additive change from here.
- **In-memory rate limiting, not this token, is still what bounds cost
  and volume** (`docs/API_CONTRACT.md`) — a valid token doesn't grant
  unlimited calls; Phase 9's per-process rate limiter still applies on top
  of this.
- **Not a substitute for TLS.** Locally, everything is plain HTTP over
  loopback (`docker-compose.saas.yml` binds both ports to `127.0.0.1`
  specifically because of this — see `docs/DOCKER_SAAS_STACK.md`). A real
  deployment on a real network needs TLS on both hops; this token proves
  *identity*, not *confidentiality* in transit.

---

## Compatibility with future multi-user/roles/organizations

The `sub` claim is already a real, per-request-verified user id — not a
placeholder. Extending this later means:

- **Real per-user accounts**: `sub` already carries whatever id Auth.js's
  session produces; nothing here assumes it's always `"personal-user"`.
- **Roles**: add a `role` claim to the signed payload
  (`mintApiToken`/`SignJWT`) and read it in `require_auth()`'s returned
  `AuthenticatedUser` — additive on both sides, no existing claim changes
  shape.
- **Organizations/multi-tenancy**: same pattern — an additional claim
  (e.g. `org_id`), threaded through the same two functions. `route_query()`
  itself remains untouched either way; any authorization decision based on
  these claims happens in the dependency/route layer, strictly before
  `route_query()` is ever called, exactly as `require_auth()` already does
  today for the simpler "is this caller who they claim to be" check.

---

## What changed vs. what stayed the same

**New**: `apps/api/auth.py` (verification, `require_auth` dependency),
`apps/web/lib/api-token.ts` (signing), `apps/web/app/actions/api-token.ts`
(the Server Action that ties signing to a real session).

**Modified**: `apps/api/main.py` (`/chat` and `/tools` now depend on
`require_auth`; `/health` deliberately does not — see
`docs/API_CONTRACT.md`), `apps/web/lib/api.ts` (`chat()`/`listTools()`
attach the token; `getHealth()` unchanged).

**Unchanged, verified via `git diff --stat -- src/ app.py`**: `src/`,
`app.py`, `route_query()`, every tool, the Odoo read-only security model.
The verified user id is never threaded into `route_query()` — it's used
only as an accept/reject gate strictly before that function is ever
called, so its signature and behavior are identical to before this phase.
`ChatRequest`/`ChatResponse`'s shapes are also unchanged — this phase adds
an authentication *requirement*, not a data contract change (existing
callers that already send a valid token see no difference in
request/response shape at all).
