# Odoo Read-Only User — `AI_AGENT_READONLY` (Layer 1, Primary Protection)

This is the **primary** security layer for the AI agent's Odoo integration. The
agent authenticates as a dedicated Odoo user whose access rights make every
write **technically impossible at the database/ORM level**, regardless of what
the Python code or the LLM attempts.

> Defense-in-depth ordering:
> 1. **Primary — this document:** the Odoo user has no create/write/unlink/post ACLs.
> 2. **Secondary — `src/services/odoo_security.py`:** Python whitelist that only
>    permits `search`, `search_read`, `read`.
> 3. **Tertiary — `src/services/odoo_config.py`:** startup refuses to run unless
>    the configured user equals `AI_AGENT_READONLY`.
>
> If any single layer were misconfigured, the others still prevent data changes.

---

## 1. Goal

| Allowed (read) | Forbidden (write) |
|---|---|
| Read customers, invoices, payments | Create / edit / delete any record |
| Read products, inventory levels | Post journal entries (`action_post`) |
| Read sales orders / lines | Confirm sales/purchase orders (`action_confirm`) |
| Read accounting & sales reports | Reconcile payments, validate transfers |

The agent is an **ERP Analyst**, never an **ERP Operator**.

---

## 2. Models the agent reads (and ONLY these)

| Purpose | Model | Access needed |
|---|---|---|
| Customers | `res.partner` | read |
| Invoices | `account.move` | read |
| Invoice lines / journal items | `account.move.line` | read |
| Payments | `account.payment` | read |
| Products | `product.product`, `product.template` | read |
| Product categories | `product.category` | read |
| Sales | `sale.order`, `sale.order.line` | read |
| Currencies | `res.currency` | read |

No other model should be reachable.

---

## 3. Create the user

1. **Settings → Users & Companies → Users → New.**
2. Name: `AI Agent (Read Only)`; Login: `AI_AGENT_READONLY`.
3. User type: **Internal User** (not Portal/Public — those can't read accounting;
   not Administrator).
4. **Do NOT** grant any of these functional groups (each implies write/post):
   - Accounting / Invoicing: *Billing*, *Accountant*, *Adviser*
   - Sales: *User*, *Administrator*
   - Inventory, Purchase, Settings/Technical (Administration: Settings)
   Leave all application access set to the lowest/blank level.
5. Prefer **API Key** auth over a password: open the user → **Account Security →
   New API Key**. Use that key as `ODOO_PASSWORD` in `.env` (XML-RPC accepts an
   API key in place of the password).

---

## 4. Grant read-only access via a custom group

Odoo has no built-in "read everything" group, so define an explicit one. The
authoritative control is `ir.model.access` with **only `perm_read` enabled**.

**Settings → Technical → Security → Groups → New:** name it
`AI Agent Read-Only`, assign it to `AI_AGENT_READONLY`, then add these
**Access Rights** (Technical → Security → Access Rights):

| Model (`model_id`) | Group | `perm_read` | `perm_write` | `perm_create` | `perm_unlink` |
|---|---|---|---|---|---|
| `res.partner` | AI Agent Read-Only | ✅ 1 | 0 | 0 | 0 |
| `account.move` | AI Agent Read-Only | ✅ 1 | 0 | 0 | 0 |
| `account.move.line` | AI Agent Read-Only | ✅ 1 | 0 | 0 | 0 |
| `account.payment` | AI Agent Read-Only | ✅ 1 | 0 | 0 | 0 |
| `product.product` | AI Agent Read-Only | ✅ 1 | 0 | 0 | 0 |
| `product.template` | AI Agent Read-Only | ✅ 1 | 0 | 0 | 0 |
| `product.category` | AI Agent Read-Only | ✅ 1 | 0 | 0 | 0 |
| `sale.order` | AI Agent Read-Only | ✅ 1 | 0 | 0 | 0 |
| `sale.order.line` | AI Agent Read-Only | ✅ 1 | 0 | 0 | 0 |
| `res.currency` | AI Agent Read-Only | ✅ 1 | 0 | 0 | 0 |

**Rule of thumb:** every ACL row for this group has `perm_write = perm_create =
perm_unlink = 0`. No exceptions.

> Note: if the user also inherits the base *Internal User* ACLs (which grant some
> writes on personal models like `res.users` own record or `mail.message`), keep
> those to a minimum. The business models above are what matters; the Layer-2
> whitelist additionally blocks any write method even on incidentally-writable
> models.

---

## 5. Optional: record rules to scope rows

To further limit exposure, add `ir.rule` (Record Rules) restricting, e.g.,
`account.move` to `move_type in ('out_invoice','out_refund')` and
`state = 'posted'`. This is optional hardening; the read-only ACLs are the
mandatory part.

---

## 6. Bind to the application

In `.env`:

```
ODOO_URL=https://your-odoo-host
ODOO_DB=your-db-name
ODOO_USERNAME=AI_AGENT_READONLY
ODOO_PASSWORD=<api-key-or-password>
EXPECTED_ODOO_USER=AI_AGENT_READONLY
```

`src/services/odoo_config.py::validate_startup()` refuses to start if
`ODOO_USERNAME != EXPECTED_ODOO_USER`, so the app cannot accidentally run as
`admin` or any privileged account.

---

## 7. Verification checklist (do this after setup)

Log in **as `AI_AGENT_READONLY`** in a browser and confirm:

- [ ] Opening a customer/invoice/payment shows data but **no editable fields**
      (or Save fails with an access error).
- [ ] Attempting to create a new invoice is blocked.
- [ ] The user does **not** see the *Post* / *Confirm* / *Register Payment* /
      *Reconcile* buttons (or they error).

From code, prove the same via XML-RPC (read works, write raises
`AccessError`) — covered by `tests/test_odoo_connection.py` (read paths) and the
read-only design; never run a write probe against production.

If a write succeeds for this user, **stop and fix the ACLs** — Layer 1 has failed
and must be corrected before connecting the agent.
