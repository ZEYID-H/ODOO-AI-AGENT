# Security Review — Odoo Read-Only Integration

**Scope:** the AI agent's access to Odoo ERP.
**Classification:** READ-ONLY system. The agent is an **ERP Analyst**, never an
**ERP Operator**.
**Status:** security layer implemented and tested; live gateway (`odoo_service.py`)
not yet built.

This is a threat model, not generic documentation. It states what is protected,
by what, and what is *not* protected.

---

## 1. System boundary

**What the AI agent CAN access (reads only):**
- `res.partner` (customers), `account.move` + `account.move.line` (invoices),
  `account.payment` (payments), `product.product` / `product.template` /
  `product.category` (products), `sale.order` / `sale.order.line` (sales),
  `res.currency`.
- Access method is limited to `search`, `search_read`, `read`.

**What the AI agent CANNOT access / do:**
- Any create, write, unlink, copy, post, confirm, validate, or reconcile.
- Any Odoo model not in the least-privilege list above.
- Any Odoo method outside the whitelist (blocked by exclusion).

**Where Odoo access starts and ends:**
- **Starts** only inside the future single gateway `src/services/odoo_service.py`,
  which must call `validate_startup()` once and route every call through
  `enforce_read_only()`.
- **Ends** there: no other module may open an XML-RPC connection or call
  `execute_kw`. This is enforced by `test_no_direct_xmlrpc_outside_gateway`.

**Security tests make NO Odoo connection.** `tests/test_security.py` exercises
`enforce_read_only()` (pure function), `validate_startup()` (reads env only), the
audit log, and a static source scan. No `ServerProxy` is instantiated and no
network call is made. The guard is therefore verifiable offline and in CI.

---

## 2. Trust model (defense in depth)

| Order | Layer | Role | Implementation |
|---|---|---|---|
| 1 — Primary | Odoo ACLs for `AI_AGENT_READONLY` | **Prevention** at the DB/ORM level | `docs/ODOO_READONLY_USER.md` |
| 2 — Secondary | Python read-only guard | **Prevention** at the process level | `enforce_read_only()` whitelist |
| 3 — Tertiary | Startup config validation | **Prevention** — fail-closed boot | `validate_startup()` |
| 4 — Detection | Audit log | **Evidence**, not prevention | `security_audit.log` |

Key principle: **the audit log does not stop anything.** It records ALLOWED/BLOCKED
decisions for investigation. Prevention is Layers 1–3.

If Layer 1 is correctly configured, even a total compromise of the Python code
cannot write to Odoo (the user has no write ACL). If Layer 1 is misconfigured,
Layer 2 still blocks every non-read method that passes through the gateway.

---

## 3. Attack vectors & 4. Mitigations

| # | Attack vector | Mitigation(s) | Residual |
|---|---|---|---|
| A1 | **LLM prompt injection** ("create an invoice", "post this", "reconcile") | The LLM only selects among 7 read tools; it cannot name Odoo methods. Even a malicious tool call resolves to read functions. Layer 2 `enforce_read_only()` blocks any write method; Layer 1 ACLs block it at the DB. | None practical for writes; see R1 (data exposure). |
| A2 | **Developer calls `execute_kw` directly** (bypassing the guard) | `test_no_direct_xmlrpc_outside_gateway` fails CI if `execute_kw`/`ServerProxy` appears in any `src/` file except `odoo_service.py`. The gateway itself wraps every call in `enforce_read_only()`. | Bypass possible only by also editing/deleting the test (see R3). |
| A3 | **App run with an admin Odoo account** | `validate_startup()` raises unless `ODOO_USERNAME == EXPECTED_ODOO_USER` (`AI_AGENT_READONLY`). | If someone sets `EXPECTED_ODOO_USER=admin` *and* uses admin creds, Layer 2 still blocks writes; but read scope widens (R1). |
| A4 | **`READ_ONLY_MODE` accidentally disabled** | `assert_read_only_mode()` runs at import of `odoo_security` and inside `enforce_read_only()` and `validate_startup()`; setting it `False` makes import/boot raise. Proven by `test_startup_refuses_when_mode_disabled`. | None unless code is edited (R3). |
| A5 | **Missing/wrong environment variables** | `validate_startup()` raises on any missing `ODOO_URL/DB/USERNAME/PASSWORD`. Proven by `test_startup_fails_on_missing_credentials`. | Wrong-but-present values fail at auth, not silently write. |
| A6 | **A future module introduces write methods** | Operational rule (§6) + `test_no_direct_xmlrpc_outside_gateway` + whitelist-by-exclusion: any new method that isn't `search/search_read/read` is blocked. | Requires reclassifying the whole project (R3/§6). |
| A7 | **API key leakage** | Keys live only in `.env` (never code). `.env` excluded from Git; only `.env.example` (placeholder) is committed. Use a per-user Odoo **API key** that can be revoked without changing the password. | A leaked key still grants **read** to the agent's scope (R1); rotate immediately. |
| A8 | **Audit log tampering/deletion** | `security_audit.log` is append-only via the logging handler during runtime. | A user with filesystem access can delete/alter it (R4); ship logs off-host for tamper-evidence. |
| A9 | **Over-broad Odoo read access** exposing sensitive data | Least-privilege model list (§1, `docs/...`); optional `ir.rule` row filters (e.g. posted customer invoices only). | Read-only ≠ privacy-safe; financial/PII data is still readable within scope (R1). |

---

## 5. Residual risks (honest)

- **R1 — Read-only is not privacy-safe.** The agent can read customer PII,
  balances, and financials within its scope, and the LLM may surface that data.
  Confidentiality depends on the least-privilege model list and Odoo record
  rules, not on the read-only guard.
- **R2 — Layer 1 dependency.** If the Odoo ACLs are misconfigured (the user
  *can* write), the Python guard becomes the *main* barrier. That is a secondary
  layer doing a primary job — degraded, not safe. Verify §7 of the user doc.
- **R3 — Insider with code/server access.** Anyone who can edit the source or
  tests can remove the guard, delete `test_no_direct_xmlrpc_outside_gateway`, or
  flip `READ_ONLY_MODE`. Code-level protection assumes code integrity (reviews,
  branch protection, restricted deploy).
- **R4 — Audit logs prove events only if protected.** Deletable logs are weak
  evidence. Forward to an append-only/remote sink for real auditability.
- **R5 — No production write probes.** Never "test" write-blocking against
  production by attempting a real write. Verification uses read paths and the
  offline guard tests only.

---

## 6. Required operational rules

1. **Never** run the agent with admin or any write-capable Odoo credentials.
2. **Never** commit API keys or `.env` to Git (commit only `.env.example`).
3. **Never** call XML-RPC (`execute_kw`/`ServerProxy`) outside
   `src/services/odoo_service.py`.
4. **Never** add a new Odoo model without adding it to
   `docs/ODOO_READONLY_USER.md` (ACL table) and the relevant tests.
5. **Never** add a write-capable method unless the entire project is formally
   reclassified out of read-only (which invalidates this review).

---

## 7. Final security verdict

**Safe to proceed to building `odoo_service.py` — under these assumptions:**

- The Odoo user `AI_AGENT_READONLY` is configured per `docs/ODOO_READONLY_USER.md`
  (read-only ACLs; no functional write/post groups). *This is the primary control
  and is configured by the Odoo admin, outside this codebase.*
- `odoo_service.py`, when built, (a) calls `validate_startup()` once before
  connecting, (b) is the ONLY file using `execute_kw`/`ServerProxy`, and
  (c) routes every call through `enforce_read_only()`.
- `.env` is excluded from version control and holds the read-only user's
  credentials/API key only.
- Code and tests are protected by review and access control (R3).

Under these assumptions the agent is **technically incapable of modifying Odoo
data**, even under prompt injection, hallucinated tool calls, or buggy code,
because writes are blocked independently at the ACL, process, and boot layers.

**Conditions to re-review:** any new model, any new XML-RPC call site, any change
to the whitelist or `READ_ONLY_MODE`, or any move away from read-only.

---

## 8. Current deployment state (testing — NOT production)

As of the read-only connection verification, the agent authenticates against a
**neutralized/testing Odoo database** using an existing developer account
(`uid=2`, the project owner's login), **NOT** the production `AI_AGENT_READONLY`
user. `EXPECTED_ODOO_USER` is temporarily set to that dev login so
`validate_startup()` passes.

Consequence: **Layer 1 (ACL prevention) is NOT yet in force** — the dev user may
hold write ACLs. Writes are presently blocked ONLY by Layer 2 (the Python guard)
and Layer 3 (startup validation). This is acceptable for a neutralized test DB,
but is a degraded posture (see R2) and **must be corrected before any real or
production data is connected**:

1. Create/configure `AI_AGENT_READONLY` per `docs/ODOO_READONLY_USER.md`.
2. Set both `ODOO_USERNAME` and `EXPECTED_ODOO_USER` to `AI_AGENT_READONLY`.
3. Re-run `tests/test_odoo_connection.py` and the gateway `verify()`.
