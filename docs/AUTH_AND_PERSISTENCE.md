# Authentication & Conversation Persistence — `apps/web`

Canonical reference for how `apps/web` decides who's allowed in
(Phase 8E) and how it remembers what they said (Phase 8F). Both are
deliberately minimal — this document is as much about what's **not** built
as what is; see the last section before relying on either for anything
beyond personal/internal use.

Neither system touches `src/`, `route_query()`, or Odoo in any way. They
answer "who is this?" and "what did they say?" — never "what's the answer?"

---

## Authentication

### Approach: single shared password, no user table

[Auth.js (NextAuth v5)](https://authjs.dev), configured in `apps/web/auth.ts`
with one `Credentials` provider. There is no OAuth, no user database, no
sign-up flow — logging in means submitting the one password stored in
`APP_ACCESS_PASSWORD`.

The actual check is `lib/auth-credentials.ts::verifyAppPassword`, kept as a
plain, directly-testable function outside Auth.js's `authorize()` callback:

```ts
export function verifyAppPassword(password: unknown): AppUser | null {
  const expected = process.env.APP_ACCESS_PASSWORD;
  if (!expected) return null;                          // fails closed
  if (typeof password !== "string" || !password) return null;
  if (password !== expected) return null;
  return { id: "personal-user", name: "Personal Access" };
}
```

Every successful login yields the **same** synthetic user:
`id: "personal-user"`. There is exactly one account. This is why
conversation ownership (below) is real foreign-key plumbing rather than a
loose string match — the plumbing is multi-user-ready even though today
there is only ever one user.

**Fails closed, not open**: if `APP_ACCESS_PASSWORD` is unset, login always
fails — nobody gets in by accident because an operator forgot to configure
a secret.

### Session strategy: JWT, no database

`session: { strategy: "jwt" }` in `auth.ts` — no Auth.js database adapter is
configured. Session state lives **only** in a signed, http-only cookie
(`authjs.session-token`); never in `localStorage`, never readable by
client-side JavaScript.

**A finding worth calling out** (discovered by reading `@auth/core`'s
source directly, not assumed): Auth.js's *default* `session` callback
strips everything except `name`/`email`/`image` — `session.user.id` is
**not** populated by default, even though the JWT's internal `sub` claim
already holds it. Conversation ownership needs a stable user id, so
`auth.ts` defines explicit callbacks:

```ts
callbacks: {
  jwt({ token, user }) {
    if (user) token.sub = user.id;
    return token;
  },
  session({ session, token }) {
    if (token.sub) session.user.id = token.sub;
    return session;
  },
},
```

Without these, `session.user.id` would be `undefined` and every
conversation-ownership check in `app/actions/conversations.ts` would throw
"Not authenticated" for a genuinely logged-in user.

### Protected routes: a Server Component guard, not Proxy

`app/dashboard/page.tsx` calls `requireSession()`
(`lib/session-guard.ts`) **before** rendering anything:

```ts
export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session) redirect("/login");
  return session;
}
```

An unauthenticated request never receives the dashboard's HTML at all —
verified with a plain `curl` request (no JavaScript, no cookies): a bare
redirect to `/login`.

**Deliberately not implemented as `proxy.ts`** (Next.js 16's renamed
Middleware). Next's own documentation explicitly describes Proxy as
insufficient as a sole authorization layer — recommended only for
"optimistic" checks (skip a render before redirecting), not as the actual
guarantee. The real protection has to live as close to the protected
content as possible, which is what `requireSession()` is. This project has
no `proxy.ts` for `/dashboard` at all.

### Login/logout flow

- `/login` (`app/login/page.tsx`) — a Server Component that redirects
  already-authenticated visitors straight to `/dashboard`; otherwise renders
  `components/LoginForm.tsx`, which posts to the `loginAction` Server Action
  (`app/actions/auth.ts`).
- A wrong password returns a generic `"Invalid password. Please try again."`
  — it never reveals whether the env var is missing vs. the password is
  simply wrong.
- Logout: Sidebar's "🚪 Log Out" button posts to `logoutAction()`
  (`signOut()`), clearing the session cookie and redirecting to `/`.
- `/` is always public, regardless of auth state, and links to `/dashboard`
  (which redirects unauthenticated visitors onward to `/login`).

### Required environment variables

| Variable | Purpose | Fails how if missing |
|---|---|---|
| `AUTH_SECRET` | Signs/encrypts the session JWT. | Auth.js refuses to start (`MissingSecret`). |
| `APP_ACCESS_PASSWORD` | The one shared password. | Login always fails — fails closed. |
| `AUTH_TRUST_HOST` | Required specifically in the Docker image. | See below. |

**`AUTH_TRUST_HOST` — a Docker-specific gotcha, verified against
`@auth/core`'s own env-default logic, not assumed:**

```js
config.trustHost ??= !!(
  envObject.AUTH_URL ?? envObject.AUTH_TRUST_HOST ??
  envObject.VERCEL ?? envObject.CF_PAGES ??
  envObject.NODE_ENV !== "production"
);
```

`trustHost` defaults to `true` automatically whenever `NODE_ENV !==
"production"` — true for `next dev`, so local development works with zero
extra configuration. The Docker image runs `next start` with
`NODE_ENV=production`, which disables that fallback; without
`AUTH_TRUST_HOST=true` set explicitly (as `docker-compose.saas.yml` does),
Auth.js rejects every request with an `UntrustedHost` error and login fails
closed inside the container specifically. See
[`DOCKER_SAAS_STACK.md`](DOCKER_SAAS_STACK.md).

---

## Conversation Persistence

### Data model

Prisma + SQLite (via the `@prisma/adapter-libsql` driver adapter — Prisma
7 requires an explicit adapter, there is no more zero-config
`new PrismaClient()`). Schema at `apps/web/prisma/schema.prisma`:

```
User (id, createdAt)
  └─< Conversation (id, title, createdAt, updatedAt, userId)
        └─< Message (id, role, content, timestamp, conversationId)
```

Both relations are `onDelete: Cascade` — deleting a conversation deletes
its messages; deleting a user deletes their conversations and messages.

**Only `role`, `content`, and `timestamp` are ever persisted per message.**
No tool name, no parameters, no formatted-vs-lightweight distinction — those
are UI/API concerns (`apps/web/lib/history.ts`,
[`API_CONTRACT.md`](API_CONTRACT.md)), not storage concerns. `role` is a
plain `String`, not a Prisma `enum`, for SQLite/Postgres portability;
validity is enforced at the application boundary.

**Migration-friendly by design**: every type used (`String`, `DateTime`,
`cuid()` ids) is portable to Postgres — moving later means changing
`provider` and `DATABASE_URL` in `prisma.config.ts` only, no field/type
changes.

### Ownership model

Every Server Action in `app/actions/conversations.ts` re-derives the user
id from the server-side session (`requireUserId()` → `auth()`) — a client
can never pass a `userId`. Reads and writes on a specific conversation go
through one chokepoint:

```ts
async function findOwnedConversation(conversationId: string, userId: string) {
  return prisma.conversation.findFirst({ where: { id: conversationId, userId } });
}
```

This returns `null` identically whether the conversation **doesn't exist**
or **belongs to someone else** — callers (and thus API responses) can never
distinguish the two, which prevents a conversation ID from being used to
probe for other users' data. Verified directly in
`tests/conversations.test.ts`: a second user cannot load, rename, delete,
or append to the first user's conversations, and never sees them in their
own list.

In practice, since authentication yields only the single `"personal-user"`
account today, this ownership boundary has never actually been exercised
against a *second real user* outside of tests — it's correct machinery
waiting for real multi-user auth, not something battle-tested in
production.

### CRUD surface (`app/actions/conversations.ts`)

| Function | Used by | Notes |
|---|---|---|
| `createConversation(title?)` | "New Chat" button (client-triggered) | Calls `revalidatePath("/dashboard")` — only valid *outside* a render of that route. |
| `ensureInitialConversation()` | `app/dashboard/page.tsx`'s own server render | Auto-creates a first conversation if the user has none. Deliberately does **not** call `revalidatePath` — Next.js forbids that mid-render of the same route (a real bug hit and fixed during Phase 8G's Docker validation). |
| `listConversations()` | Sidebar list | Newest-updated first. |
| `loadConversation(id)` | Switching conversations | Returns `null` for a nonexistent/foreign id (see ownership model above). |
| `renameConversation(id, title)` | Sidebar rename | Rejects empty/whitespace-only titles. |
| `deleteConversation(id)` | Sidebar delete | Cascades to messages. |
| `appendMessage(id, role, content)` | After every completed `/chat` round trip | Also bumps `updatedAt` (in the same transaction) so the sidebar re-sorts by recency. |

### Chat flow (where AI logic and persistence meet — and don't)

1. `app/dashboard/page.tsx` loads the active conversation's messages
   server-side and passes them to `DashboardClient` as props.
2. `DashboardClient` sends the question, plus lightweight history built
   from those messages, to `POST /chat` (`lib/api.ts`) — this call is
   **client-side**, from the browser, never touching Prisma.
3. On a completed round trip (success *or* a `success: false` answer — both
   are real conversation turns), `DashboardClient` calls `appendMessage()`
   twice: once for the user's question, once for the assistant's reply.
4. A thrown `ApiError` (network failure) is **never** persisted — it's a
   transient UI error, not a conversation turn.

**The lightweight-history contract has to work for two different content
shapes.** A freshly-received `/chat` response carries a `tool` field
(`ChatTurn.tool`); a message reloaded from the database never does — only
`role`/`content`/`timestamp` are ever stored. `lib/history.ts`'s
`buildLightweightHistory` therefore collapses a turn to a short placeholder
on **either** signal: an explicit `tool` flag, **or** a content-shape
heuristic (≥3 `|` characters, or longer than 300 characters) mirroring the
same heuristic already used server-side
(`apps/api/main.py::filter_history`). Without the second signal, a reloaded
conversation would resend a full markdown table as "history" on the very
next message — exactly what this contract exists to prevent. Covered by
dedicated tests in `tests/history.test.ts`.

### Where the database lives

| Context | `DATABASE_URL` | Notes |
|---|---|---|
| Local dev (`npm run dev`) | `file:./prisma/dev.db` (`.env`) | Gitignored, per-machine. |
| Tests (`npm run test`) | `file:./prisma/test.db` (`vitest.config.ts`) | Isolated from dev data; schema kept current via a `pretest` script running `prisma migrate deploy`. |
| Docker Compose | `file:/data/conversations.db` | `/data` is the `conversations-data` named volume — survives container restarts/recreates. See [`DOCKER_SAAS_STACK.md`](DOCKER_SAAS_STACK.md). |

`prisma/migrations/` (the schema history) is committed; the actual `.db`
files never are.

---

## What is intentionally NOT implemented yet

Both systems are deliberately minimal "Option A" implementations for
personal/internal use — not a public SaaS auth/persistence layer. Treat
absence of the following as expected, not a bug, but do not launch this
publicly without addressing them (see
[`NEXT_PHASES.md`](NEXT_PHASES.md) for sequencing):

- **No real user accounts.** One shared password → one synthetic user.
  No sign-up, no per-user credentials, no password reset, no email.
- **No OAuth / SSO / MFA.**
- **No roles or permissions.** Anyone with the password has full access to
  every conversation the single account owns (which, today, is everyone's,
  since there's only one account).
- **No rate limiting on login.** The credentials `authorize()` callback has
  no brute-force protection.
- **No audit log for auth events** (login/logout aren't logged anywhere,
  unlike Odoo reads — see `SECURITY_REVIEW.md` for how that's handled
  elsewhere in this project).
- **SQLite is not a concurrent-production database.** Fine for one
  container, one user, local/small-scale deployment; a real multi-instance
  or multi-user production deployment needs Postgres (the schema is
  designed for exactly that migration, but it hasn't happened).
- **No conversation search, pagination, or archiving** — the sidebar list
  loads every conversation for the user unbounded.
- **No data export or deletion beyond per-conversation delete** — no
  "delete my account and all my data" flow.
