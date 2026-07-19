# AG4 — Live Odoo Data Accuracy Validation

**Status: `BLOCKED — awaiting live Odoo access`** (2026-07-16)

All safe preparation work is complete and committed: the opt-in live
validation harness exists, is tested in both gate modes, and will execute the
full tool-by-tool accuracy program the moment a reachable Odoo instance is
configured. **No live case has been executed; no tool is claimed PASS.**

---

## 1. Environment Summary

| Item | Finding |
|---|---|
| Deployment type | Odoo Online (SaaS) — a `*.odoo.com` subdomain |
| Odoo version | **Unknown** — unreachable (see blocker) |
| Company context | Unknown — unreachable |
| Authentication method | XML-RPC user+password via the existing read-only gateway (`src/services/odoo_service.py`) |
| Credentials in environment | `ODOO_URL` ✅ SET, `ODOO_DB` ✅ SET, `ODOO_USERNAME` ✅ SET, `ODOO_PASSWORD` ✅ SET, `EXPECTED_ODOO_USER` ✅ SET (values never printed or committed) |
| `validate_startup()` (read-only mode, credentials present, dedicated user) | ✅ PASSED |
| Connection | ❌ **FAILED** |

### The blocker (evidence)

Every endpoint on the configured host returns **HTTP 404**, probed 2026-07-16
with harmless unauthenticated requests:

| Endpoint | Result |
|---|---|
| `/xmlrpc/2/common` (version call) | 404 |
| `/xmlrpc/common` (legacy) | 404 |
| `/jsonrpc` (version call) | 404 |
| `/web/login` (the login page itself) | 404 |

A 404 on `/web/login` means this is **not** an API-permission issue — the
database itself no longer answers at that address. The most likely cause:
Odoo Online **trial databases are automatically deleted after their trial
expires/inactivity**. Resolution options for the owner:

1. Create a fresh Odoo instance (Odoo Online paid plan — note: the external
   XML-RPC API is not available on free/one-app plans — or a self-hosted /
   Odoo.sh instance), recreate the dedicated read-only user per
   `docs/ODOO_READONLY_USER.md`, and update `ODOO_URL`/`ODOO_DB` in `.env`.
2. Then run: `RUN_LIVE_ODOO=1 python -m pytest tests/live_odoo -v`

## 2. Tool Validation Matrix (canonical AG4 inventory — all 14 registered tools)

Tool list re-verified by importing `TOOL_REGISTRY` (14 entries). Status is
**BLOCKED** for every tool: live comparison was impossible; nothing below is
claimed accurate against real data.

| # | Tool | Odoo models used (via provider) | Key fields | Filters | Aggregation | Output | Live status |
|---|---|---|---|---|---|---|---|
| 1 | `get_customer_balance` | `res.partner`, `account.move` | amount_total, amount_residual, payment_state, invoice_date_due | move_type=out_invoice, state=posted | sum(amount − paid) over open invoices | dict | **BLOCKED** |
| 2 | `get_customer_summary` | + `account.payment` | + amount, date | + partner_type=customer, payment_type=inbound | billed/paid totals + lists | dict | **BLOCKED** |
| 3 | `get_payment_history` | `account.payment` | amount, date, journal, ref | inbound customer payments (**no state filter — Q1**) | count + sum, newest first | dict | **BLOCKED** |
| 4 | `get_top_debtors` | `account.move` | as #1 | open invoices | per-partner outstanding, ranked | dict | **BLOCKED** |
| 5 | `get_customer_statement` | `account.move` + `account.payment` | as #1/#3 | posted invoices + payments | chronological ledger, running balance | dict | **BLOCKED** |
| 6 | `get_unpaid_invoices` | `account.move` | as #1 | open invoices, optional customer/period | count + residual sum | dict | **BLOCKED** |
| 7 | `get_overdue_invoices` | `account.move` | as #1 | residual>0 ∧ due<today | grouped by customer, ranked | dict | **BLOCKED** |
| 8 | `get_top_selling_products` | `sale.order.line`, `sale.order`, `product.product` | qty, price_subtotal, date_order, categ | order state ∈ {sale, done} | per-product revenue/qty, ranked | dict | **BLOCKED** |
| 9 | `get_sales_summary` | same as #8 | same | + period filter on date_order | revenue/count/avg + top-5 breakdowns | dict | **BLOCKED** |
| 10 | `get_dashboard_summary` | composition of #4/#6/#7/#8/#9 | — | — | none of its own | dict | **BLOCKED** |
| 11 | `get_collection_priorities` | composition of #4/#7 | — | — | score = overdue×(1+days/30)+invoices×100 | dict | **BLOCKED** |
| 12 | `get_customer_insights` | #1 + `sale.order.line` | + sales totals/dates | — | lifetime revenue, recency, risk heuristic | dict | **BLOCKED** |
| 13 | `get_product_insights` | `sale.order.line` (+#9 for share) | qty, subtotal, dates | exact-or-contains product match | revenue/units/share/top customers | dict | **BLOCKED** |
| 14 | `get_business_alerts` | composition of #3/#6/#8/#9/#11 | — | — | 5 heuristic alert categories | dict | **BLOCKED** |

## 3. Discrepancy Register

Empty by necessity — no live comparison could run. **Candidate discrepancies
already identified by code inspection**, encoded as live assertions in the
harness so they resolve automatically on first successful run:

| ID | Severity (if confirmed) | Suspicion | Where the harness tests it |
|---|---|---|---|
| AG4-Q1 | High | `_odoo_payments()` applies **no `state` filter** — draft/cancelled payments may inflate payment history and summary "total paid" | `test_payment_history_totals_and_state_filtering` fails loudly with a diagnosis if the tool matches the "all states" total but not the "posted-only" total |
| AG4-Q2 | High | Credit notes (`out_refund`) are **excluded** from invoices and invoice-derived balances; unreconciled credit notes would make the tool's balance differ from the receivable ledger | receivable-ledger cross-check inside `test_customer_balance_matches_raw_invoices_and_receivable_ledger` |
| AG4-Q3 | Medium | Currency label is a single constant (QAR); a live company on a different currency, or multi-currency invoices, would be mislabeled/summed naively | to be assessed from `instance_identity` + invoice `currency_id` on first run |
| AG4-Q4 | Low | Due-date "overdue" comparison uses naive local-date strings (timezone boundary off-by-one possible near midnight) | date-boundary family `test_sales_summary_date_boundaries` + overdue tests |

## 4. Accounting Decisions (as currently implemented — validation pending)

Documented from `src/data/provider.py` + tool code; **each remains a
to-confirm item, not a validated fact**:

- **Invoice state:** posted only (`state = 'posted'`); draft and cancelled
  excluded. Credit notes/refunds excluded entirely (`move_type =
  'out_invoice'` only) — see AG4-Q2.
- **Payment state mapping:** `payment_state ∈ {paid, in_payment, reversed}` →
  "paid"; residual > 0 with a past due date → "overdue"; otherwise "unpaid".
- **Residual source:** `account.move.amount_residual` (the tool's
  `paid_amount` is derived as `amount_total − amount_residual`). The
  harness's independent reference additionally recomputes balances from
  **posted receivable move lines** (`account.move.line.amount_residual`,
  `account_type = 'asset_receivable'`) — a deliberately different
  authoritative source.
- **Overdue:** `due_date < today` (ISO string compare, server-naive) with
  residual > 0, posted-state filtered. Missing due dates never count as
  overdue.
- **Currency:** single display currency (`formatting.CURRENCY`); no
  conversion logic exists and none was silently added — AG4-Q3.
- **Sales source of truth:** `sale.order.line` of orders in `{sale, done}`
  (confirmed orders), `price_subtotal` (untaxed); invoice lines are NOT the
  sales source; draft/cancelled orders excluded; returns/refunds not
  modeled — to verify against live data.
- **Date boundaries:** inclusive ISO ranges from
  `src/utils/date_filters.py`; validated deterministically in AG3, live
  boundary confirmation pending.

## 5. Data Coverage Limitations

Cannot be enumerated until an instance is reachable. The harness
**discovers** representative categories at run time (customer with no/paid/
unpaid/overdue/mixed invoices, with payments, credit notes; product with/
without sales; ten date windows) and reports any absent category as
`NOT REPRESENTED in live database: <category>` — it never fabricates records.

## 6. Final Accuracy Summary

| Metric | Value |
|---|---|
| Total registered tools | 14 (verified by live import) |
| Tools passed | 0 — *no tool is claimed PASS without live evidence* |
| Tools failed | 0 |
| Tools blocked | **14** |
| Live cases defined in the harness | 26 (incl. 10 date-boundary parametrizations) |
| Live cases executed | 0 |
| Unresolved limitations | the blocker itself + AG4-Q1…Q4 |

## 7. Harness Reference

- Location: `tests/live_odoo/` (`conftest.py` gate, `reference.py`
  independent calculations, `test_live_tool_accuracy.py` — 26 cases).
- Marker: `live_odoo` (registered in `pytest.ini`).
- Opt-in: `RUN_LIVE_ODOO=1 python -m pytest tests/live_odoo -v`.
- Gate behavior (both verified on 2026-07-16):
  - not requested → **26 skipped**, zero network activity;
  - requested with unreachable/failed auth → **hard error**:
    "Live Odoo validation was requested but authentication/connection
    FAILED… The suite never falls back to mock data."
- Independence guarantee: reference calculations share only the read-only
  transport (`odoo_service.search_read/read`) with production code — never
  provider normalization or tool aggregation; balances are cross-checked
  against a different model entirely (posted receivable move lines).
- Read-only proof: the only reachable methods are `{search, search_read,
  read}` — enforced by `src/services/odoo_security.py`'s whitelist-by-
  exclusion at the single RPC chokepoint, import-time asserted, audit-logged
  (`tests/test_security.py` keeps this green).

## 8. Security Evidence (this phase)

- No credentials committed; `.env` files remain git-ignored (`git ls-files`
  shows only `*.example` placeholders).
- No live exports, invoice dumps, or raw API responses committed — none
  exist (nothing was reachable); harness evidence design uses anonymized
  labels ("customer #1", "rank 1") in assertions.
- All diagnostics in this document show endpoint names and HTTP status codes
  only — no secret values were printed at any point.
