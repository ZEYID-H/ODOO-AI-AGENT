# AI Agent Tool Contracts — AG2

**Status:** AG2 complete. **Date:** 2026-07-15. **Scope:** contract, formatter,
validation, and presentation consistency only. Routing behavior, tool-selection
rules, fallback date constants, and financial formulas are all deliberately
unchanged (owners: AG3/AG4).

---

## 1. Purpose

Make every registered AI tool expose a correct, consistent, traceable, and safe
contract across the OpenAI schema, the Python implementation, `TOOL_REGISTRY`,
the formatter, `route_query()`'s result, the FastAPI response, Next.js/Streamlit
rendering, documentation, and tests. This document is the authoritative record
of those contracts and of exactly what AG2 changed. Enforcement is automated:
`python -m pytest tests/contracts -v` (95 tests, offline, no credentials).

## 2. Verified Tool Inventory

14 tools, re-verified by live import at the start of AG2 (unchanged from AG1's
inventory in `docs/AI_AGENT_EVALUATION_BASELINE.md` §2). Registry ↔ schema
parity is enforced at import time (`_validate_registry()`), at AG1's Layer A,
and again structurally by `tests/contracts/test_tool_schema_contracts.py`.

## 3. Common Contract Principles

- **One envelope.** `route_query()` returns `{"tool", "parameters", "result"}` —
  unchanged, proven compatible with `apps/api`'s `ChatResponse` by a contract
  test. `tool` is a registered tool name, `"assistant"` (OpenAI path answered
  without a tool), or `"unknown"` (rule-based fallback had no match).
- **One error shape.** A failed tool call returns `{"error": "<one readable
  sentence>"}` and formats as `**Error:** …`. No stack traces, no exception
  class names, no secrets, no Odoo/OpenAI internals — on any surface.
- **One matching rule for customers.** Case-insensitive exact match after
  whitespace strip (`customer_tools._find_customer`), and every filter
  downstream of a successful lookup uses the **canonical record name**, never
  the raw argument.
- **Empty ≠ error.** "No matching records" is a successful result with an
  explicit empty-state sentence that names its scope; it never renders as a
  blank string, a bare table header, or an `**Error:**` line.
- **Bounded output.** Detail tables cap at `TABLE_MAX_ROWS = 50` rows with an
  explicit `_Showing X of Y …_` note; ranked lists state when they are
  truncated. Totals are always computed from the full dataset.
- **Traceable financial output.** Every financial answer names its entity, its
  currency, and — when date-filtered — its date range.

## 4. Tool-by-Tool Contract Table

| Tool | Required params | Optional params | Unknown entity | Empty result | Added in AG2 |
|---|---|---|---|---|---|
| `get_customer_balance` | `customer_name` | — | `{"error"}` | zero values shown explicitly | canonical-name filtering (D13) |
| `get_customer_summary` | `customer_name` | — | `{"error"}` | empty tables w/ explicit notes | canonical-name filtering (D13) |
| `get_payment_history` | `customer_name` | — | `{"error"}` | "No payment records found." | canonical-name filtering (D13) |
| `get_customer_statement` | `customer_name` | `period` | `{"error"}` | "No transactions found." | — (already correct) |
| `get_top_debtors` | — | `limit` (10), `period` | n/a | "No outstanding balances found." | `period_label`, truncation note, limit normalization |
| `get_unpaid_invoices` | — | `customer_name`, `period` | **`{"error"}` (was silent empty)** | "No unpaid invoices found." | D1 validation, `period_label` |
| `get_overdue_invoices` | — | `period` | n/a | explicit empty state (was bare tables) | `period_label`, D12 empty state |
| `get_top_selling_products` | — | `period`, `month`, `year`, `limit` (5) | n/a | "No product data found." | `limit` now in schema (D7), `product_count`, truncation note |
| `get_sales_summary` | — | `period`, `month`, `year` | n/a | "No sales data found for this period." | `by_customer` bounded to 5 (D8), `customer_count`/`product_count` |
| `get_dashboard_summary` | — | — | n/a | N/A markers for missing top entries | — (composition only) |
| `get_collection_priorities` | — | `limit` (all) | n/a | "No overdue accounts…" (now header-free) | truncation note, limit normalization |
| `get_customer_insights` | `customer_name` | — | `{"error"}` | N/A markers for missing dates | — |
| `get_product_insights` | `product_name` | — | `{"error"}`, `mode="no_match"` | explicit error incl. query text | — (matching rules locked, already correct) |
| `get_business_alerts` | — | `limit` (10) | n/a | "No urgent business alerts at this time." | truncation note, limit normalization |

## 5. Parameter Normalization Rules

- **Customer/product names:** stripped; matched case-insensitively; results
  echo the canonical record name. A **non-empty unknown** name is
  `ENTITY_NOT_FOUND`. For `get_unpaid_invoices` only, an empty/whitespace-only
  name normalizes to *omitted* — the schema's documented "omit to list all
  customers" semantics — identically for `""` and `"   "` (pre-AG2 these two
  behaved differently).
- **Limits:** an invalid limit (non-int, `bool`, zero, negative) falls back to
  the tool's documented default (pre-AG2, `list[:-1]` silently dropped the
  *last* ranked row). Defaults: debtors 10, products 5, alerts 10,
  collections = all.
- **Periods:** free-text `period` takes priority over `month`/`year` (schema-
  documented). Recognized phrases: today/yesterday, this/last week, this/last
  month, this/last quarter, this/last year, `between <ISO> and <ISO>`,
  `from <month> to <month>`, a bare month name (current year), and — fixed in
  AG2 — a month name **with an explicit year** ("June 2025"), which previously
  resolved silently to the *current* year. Unrecognized text applies no filter
  and produces **no date label** (never a fake one).
- **Unexpected extra parameters:** `execute_tool` raises `TypeError` before any
  business logic; `route_query()` catches it and degrades to the rule-based
  fallback; `apps/api` would sanitize anything uncaught. Documented, tested,
  deliberately not swallowed inside the registry.

## 6. Financial Formatting Rules

- Single display currency, one constant: `src/utils/formatting.py::CURRENCY`
  (`"QAR"`). `fmt_currency` renders `QAR 1,234,567.89` — two decimals, thousands
  separators, explicit negative sign, no float artifacts. The data layer's
  `customer.currency` tag now derives from the same constant (it was a
  contradictory hardcoded `"USD"` that nothing consumed).
- Invoice tables show **both** `Amount` and `Outstanding` — for a partially
  paid invoice (real in Odoo mode: `paid_amount = amount_total −
  amount_residual`) the summary totals sum *outstanding*, so the column now
  visibly reconciles with them.
- Zero values render explicitly (`QAR 0.00`), never omitted.
- **Single-currency assumption:** whether live Odoo invoices are genuinely in
  this currency is AG4's validation. No value in any output is claimed to be
  reconciled against Odoo reports yet.

## 7. Date Formatting Rules

- One human format everywhere: `DD Mon YYYY` (`05 Jun 2026`) — no ambiguous
  month/day ordering. Unparseable input degrades to the raw string; empty
  dates render `N/A`, never a blank cell.
- Date-filtered results carry `period_label` (`"01 Jun 2026 – 30 Jun 2026"`)
  and their formatter displays it in the heading — added in AG2 to
  `get_unpaid_invoices`, `get_overdue_invoices`, `get_top_debtors`
  (`get_customer_statement` and the sales tools already had it).

## 8. Empty-Result Behavior

Every tool distinguishes three cases, and the distinction survives formatting:

1. **Data found** → normal result.
2. **No matching records** → `success` result, explicit italic empty-state
   sentence naming the scope (entity and/or date range), no bare table headers
   (fixed for `format_overdue_invoices` and `format_collection_priorities`).
3. **Failure** (unknown entity, bad input, upstream exception) → `{"error"}` /
   `**Error:** …` / HTTP `success:false` — visually and structurally distinct
   from case 2, proven by `test_empty_result_and_error_are_distinguishable_shapes`.

## 9. Error Taxonomy

The smallest taxonomy that matches the boundaries this codebase already has.
No new exception framework was introduced; each category names where it is
handled and what the user sees.

| Category | Boundary | User-facing form |
|---|---|---|
| `VALIDATION_ERROR` | pydantic (`apps/api/schemas.py`) for HTTP input; `TypeError` from `execute_tool` for tool args | HTTP 422 detail / fallback answer |
| `ENTITY_NOT_FOUND` | tool implementation | `**Error:** Customer 'X' not found.` |
| `AMBIGUOUS_ENTITY` | `get_product_insights` aggregation (`mode="aggregated"`, SKUs listed — never presented as one exact match); remaining ambiguity is routing-level → AG3 | aggregated result with matched-SKU list |
| `DATA_SOURCE_UNAVAILABLE` | provider/gateway exception → propagates → caught by `route_query()` (fallback) or `apps/api` (`success:false` + server-side log) | generic safe message |
| `OPENAI_UNAVAILABLE` | `is_available()` false or SDK error → rule-based fallback | normal (fallback) answer |
| `TOOL_EXECUTION_ERROR` | any uncaught tool exception, same path as above | generic safe message |
| `RATE_LIMITED` | `apps/api` `/chat` (HTTP 429, 30 req/60s) | "Too many requests…" |
| `UNAUTHORIZED` | `apps/api` auth dependency (HTTP 401) | generic refusal |
| `INTERNAL_ERROR` | `apps/api` catch-all: `success:false`, generic message, `logger.exception` server-side | "Sorry, something went wrong…" |

Structured per-response error *metadata* (machine-readable category codes in
the HTTP body) was **not** added: it would change the `ChatResponse` contract
for no current consumer need — the frontend already distinguishes failure via
`success:false` and empty-vs-error via the rules in §8. Documented limitation.

## 10. Traceability Requirements

Every financial answer identifies: the entity (canonical customer/product
name), the currency, the date range when filtered (§7), invoice-status scope
(headers say "Unpaid" / "Overdue" / "open"), counts alongside totals, and
truncation state (§3). The active data backend is shown by the surrounding
UIs (Streamlit sidebar badge; not embedded per-message).

## 11. Backward-Compatibility Guarantees

- `route_query()` envelope unchanged; `apps/api` `ChatResponse` unchanged;
  `apps/web/lib/api.ts` types unchanged; **zero changes** to `app.py`,
  `apps/api/*`, `apps/web/*`.
- All result-dict changes are **additive** (`period_label`, `product_count`,
  `customer_count`) except two deliberate, documented behavior fixes:
  `get_unpaid_invoices` unknown-customer error (D1) and canonical-name
  filtering (D13) — both replace silently-wrong output with correct output.
- `format_business_alerts` keeps the exact structural markers
  (`**Total Alerts:** N`, `### i. [Risk] Title`, `**Type:**`,
  `**Recommended Action:**`, `- detail`) that `app.py::_parse_alerts`
  regex-parses; a contract test replicates those regexes literally.
- Streamlit compiles and runs unchanged (`py_compile` + Docker runtime check).

## 12. Known Limitations

- Single-currency display (§6) pending AG4.
- No machine-readable error category codes over HTTP (§9).
- `fmt_product_table` is bounded by the tools' own `limit`, not by
  `TABLE_MAX_ROWS` (ranked lists are inherently small).
- The rule-based fallback still extracts customers from the **mock** customer
  list even when `DATA_BACKEND=odoo` (`router.py` imports `mock_data.CUSTOMERS`
  directly) — routing-layer, deferred to AG3.
- `NO_CUSTOMER_MSG` enumerates the five mock customers; accurate for the mock
  backend and for the mock-bound fallback above, stale for live Odoo — deferred
  with the same AG3 item it belongs to.

## 13. Failures Deferred to AG3 (routing — none touched by AG2)

> **AG3 UPDATE (2026-07-15):** every item below was fixed in AG3 — see
> `docs/AI_AGENT_ROUTING.md` for root causes, fixes, and regression tests.
> This list stands as the historical record of what AG2 handed over.

1. Stale `_THIS_MONTH=6/_THIS_YEAR=2026` fallback constants (+"last quarter"
   silently becoming "this month" on the fallback path).
2. `"how is X"` / `"tell me about X"` keyword mis-routing.
3. Router-level unknown-customer broadening (`_extract_customer` → `None` →
   all-customer query) — the *tool*-level half was fixed in AG2 (D1).
4. No Arabic keyword coverage in the fallback.
5. Live routing misses: "Any missed payments recently?" → `get_business_alerts`;
   follow-up "Show unpaid invoices too" re-answers the previous question.
   ("Which customers have overdue invoices?" — an AG1 stable FAIL — now passes
   4/4 after AG2's D6 schema-description fix; see the baseline doc.)
6. Mock-bound fallback customer extraction (§12).

## 14. Questions Deferred to AG4 (live-data correctness)

1. Are live Odoo amounts in the displayed currency? Multi-currency handling?
2. A customer with zero recorded sales is assessed `High` risk by
   `get_customer_insights`'s inactivity heuristic — intended?
3. Business-formula validation (collection score, credit utilization,
   revenue share) against real Odoo reports.
4. `get_dashboard_summary` totals vs Odoo's own dashboards.

## 15. Test Commands

```bash
python -m pytest tests/contracts -v      # 95 AG2 contract tests (offline)
python -m pytest tests/evals -v          # 30 AG1 Layer A tests (offline)
python -m pytest tests/ -v               # everything standalone (142)
python -m pytest apps/api/tests -v       # 44 API tests
python -m py_compile app.py apps/api/main.py apps/api/schemas.py
python scripts/run_agent_evaluation.py   # model-assisted routing baseline (needs OPENAI_API_KEY)
```
