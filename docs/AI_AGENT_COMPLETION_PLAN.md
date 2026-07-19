# Odoo AI Agent Completion Plan

**Status:** Authoritative roadmap for completing and releasing the core Odoo AI
Agent (Kaizera AI Platform's primary product). This is a documentation and
discovery phase only — no product code was changed to produce it. Governed by
`docs/PROJECT_DEVELOPMENT_GUIDE.md` (architecture boundaries, the planning gate,
the Server Action authorization rule) and cross-referenced from
`docs/REMAINING_PROJECT_ROADMAP.md`, which now records Delivery D9 and later
Delivery/OCR work as paused until this plan's Milestone C ships.

**Priority change this document records:** the project's immediate focus moves
from Delivery Management (frozen, complete through D8) back to finishing and
releasing the core AI Agent. Delivery D1–D8 remain fully in place, tested, and
untouched — see §9.

---

## 0. Verified Repository State (checked before writing this plan)

- `git status --short` → clean, no uncommitted changes.
- `HEAD` = `9513e7a` ("D8: driver in-app notifications derived from immutable
  attempt history") = `origin/main`. No unfinished D9 files exist anywhere in
  the tree — D9 was never started (confirmed: no `docs/INTERNAL_DELIVERY_PILOT*`
  files, no D9-related code).
- Every fact in §2 and §4 below was read directly from the current source
  (`src/agent/tool_registry.py`, `src/agent/router.py`,
  `src/services/openai_service.py`, `apps/api/main.py`, `apps/api/schemas.py`,
  `apps/web/components/*`, `apps/web/lib/*`, `tests/*.py`, `apps/api/tests/*.py`,
  `apps/web/tests/*`, `.github/workflows/ci.yml`, and the docs cited inline) —
  not assumed from prior documentation or memory.

---

## 1. Product Definition

**The Odoo AI Agent is a secure, read-only business intelligence assistant
that allows an OWNER user to ask natural-language questions about live Odoo
business data and receive accurate, explainable, structured answers.**

Core use cases (all backed by a registered tool — see §2):

- Customer balances, unpaid invoices, overdue invoices
- Customer summaries, statements of account, payment history
- Customer insights (analytics: lifetime revenue, risk level, purchase
  frequency) and product insights (revenue share, top customers per product)
- Top debtors, collection priorities (payment follow-up ranking)
- Sales summaries, top-selling products
- An executive dashboard summary and a proactive business-alerts feed
- Follow-up questions that resolve against recent conversation context (e.g.
  "show unpaid invoices too" after a customer was named in a prior turn)

**The Delivery Management module (D1–D8) is related — same platform, same
authentication foundation, same Docker stack — but is explicitly NOT required
for the AI Agent v1 release.** The two are independent product surfaces sharing
infrastructure; neither blocks the other's completion.

---

## 2. Verified Current State — Tool Inventory

**Tool count verified against `src/agent/tool_registry.py`'s actual
`TOOL_REGISTRY` dict, not assumed: 14.** `_validate_registry()` in that same
file fails the app at import time if `TOOL_REGISTRY` and
`src/agent/tool_schemas.py`'s `TOOL_SCHEMAS` ever describe different tool
sets — verified in place, not merely documented (also exercised by
`apps/api/tests/test_api.py::test_tools_endpoint_matches_registry`).

| # | Tool | Purpose | Required params | Optional params | Data source | Formatter | Dedicated unit test? | Frontend exposure |
|---|---|---|---|---|---|---|---|---|
| 1 | `get_customer_balance` | Outstanding balance for one customer | `customer_name` | — | `src/data/provider.py` → mock/Odoo `res.partner`+`account.move` | `format_customer_balance` | No (see §4.A) | Free-text chat only (no quick action) |
| 2 | `get_customer_summary` | Full account overview | `customer_name` | — | provider | `format_customer_summary` | No | Free-text chat only |
| 3 | `get_payment_history` | Payments made by a customer | `customer_name` | — | provider | `format_payment_history` | No | Free-text chat only |
| 4 | `get_top_debtors` | Customers ranked by outstanding balance | — | `limit`, `period` | provider | `format_top_debtors` | No | Quick action ("Who owes us the most money?") |
| 5 | `get_customer_statement` | Chronological ledger, running balance | `customer_name` | `period` | provider | `format_customer_statement` | No | Free-text chat only |
| 6 | `get_dashboard_summary` | Executive KPI rollup (composed from other tools) | — | — | provider (indirect, via other tools) | `format_dashboard_summary` | No | Quick action ("Show dashboard summary") |
| 7 | `get_collection_priorities` | Payment follow-up ranking (documented scoring formula) | — | `limit` | provider | `format_collection_priorities` | No | Free-text chat only |
| 8 | `get_customer_insights` | Customer analytics: revenue, risk level, frequency | `customer_name` | — | provider | `format_customer_insights` | No | Quick action ("Customer insights for Apple Mart") |
| 9 | `get_product_insights` | Product analytics with exact/aggregated SKU matching | `product_name` | — | provider | `format_product_insights` | No | Quick action ("Product insights for Olive Oil") |
| 10 | `get_business_alerts` | Proactive risk/opportunity feed (5 categories) | — | `limit` | provider (composed) | `format_business_alerts` | No | Quick action ("Show business alerts") |
| 11 | `get_unpaid_invoices` | Unpaid + overdue invoices, optional customer filter | — | `customer_name`, `period` | provider | `format_unpaid_invoices` | No | Quick action ("Show unpaid invoices") |
| 12 | `get_overdue_invoices` | Invoices past due, grouped by customer | — | `period` | provider | `format_overdue_invoices` | No | Quick action ("Show overdue invoices") |
| 13 | `get_top_selling_products` | Top products by revenue | — | `period`, `month`, `year` | provider | `format_top_products` | No | Free-text chat only (no quick action) |
| 14 | `get_sales_summary` | Sales performance for a period | — | `period`, `month`, `year` | provider | `format_sales_summary` | No | Quick action ("Show sales summary") |

**"Dedicated unit test?" column, verified:** `tests/test_provider.py` tests
`src/data/provider.py`'s mock-mode shape/count parity (not per-tool business
logic); `tests/test_security.py` tests read-only enforcement and registry
parity; `tests/test_date_filters.py` tests period-string parsing;
`apps/api/tests/test_api.py` tests the `/chat`/`/tools` HTTP contract, history
filtering, and rate limiting. **No test file exercises an individual tool's
computed output (e.g., does `get_top_debtors` actually rank correctly against
known mock data, does `get_collection_priorities`'s documented scoring formula
produce the documented priority levels) against `src/data/mock_data.py`'s fixed
dataset.** This is §4.A's primary finding.

**One tool intentionally NOT in this registry, verified not a gap:**
`src/tools/export_tools.py::export_customer_statement` (CSV/Excel download).
`docs/TOOLS.md` explicitly documents it as "not a tool" — verified it is
called directly by `app.py` (Streamlit) for its download buttons, not reachable
via natural-language routing. Correctly excluded from `TOOL_SCHEMAS`; not a
defect, a deliberate scope boundary (Streamlit-only feature, not yet ported to
`apps/web`'s chat UI — noted as a possible future AG5 item, not a gap).

**Live Odoo validation status:** `src/data/provider.py`'s Odoo-backend
functions (`_odoo_customers`, `_odoo_invoices`, `_odoo_payments`,
`_odoo_products`, `_odoo_sales`) exist, page through `search_read` with no
record-count ceiling, and include defensive fallbacks for version-sensitive
fields (`credit_limit` on `res.partner`, `ref` on `account.payment`). No
automated test exercises them against a real Odoo instance (expected — CI has
no live Odoo credentials) and `tests/test_odoo_connection.py` is a manual
verification script (zero `test_*` functions, not collected by pytest) rather
than an automated regression test. **This is the entire subject of AG4.**

**Documentation coverage:** `docs/TOOLS.md` (14 tools, each with purpose,
typical questions, and full return-field documentation — verified consistent
with the registry above) and `docs/API_CONTRACT.md` (235 lines, `/chat`/`/tools`
contract) both exist and were spot-checked as materially accurate against the
current code, not stale.

---

## 3. AI Agent v1 Completion Definition

The Odoo AI Agent is **v1-complete** when all of the following hold, each with
verifiable evidence (not merely asserted):

1. All 14 registered tools behave correctly against live Odoo data — validated
   per AG4's checklist against known Odoo reports/records, not only mock data.
2. Routing chooses the correct tool reliably for both the OpenAI path and the
   rule-based fallback, measured against a fixed evaluation set (AG1) covering
   English and Arabic phrasing.
3. Ambiguous or unknown customer/product names are handled safely — no
   fabricated match, no silent wrong-entity answer (`get_product_insights`'s
   `mode: exact/aggregated/no_match` pattern is the model to extend, not
   invent).
4. Follow-up questions work within the supported lightweight-history model
   (verified: `apps/web/lib/history.ts` + `apps/api/main.py::filter_history`
   both already cap history and strip tool-output tables — the mechanism
   exists; AG3 validates its actual routing behavior).
5. Answers clearly distinguish facts (tool output, `ENABLE_AI_INSIGHTS=False`
   by default — verified in `src/services/openai_service.py`, meaning the
   user-visible answer is the tool's own formatted markdown, not an
   LLM-paraphrased summary that could drift from the numbers) from any future
   interpretation layer, if one is ever enabled.
6. Tool failures produce a readable error, never a stack trace or raw
   exception (verified: `apps/api/main.py::chat` catches broadly and logs
   server-side only; `apps/web/lib/api.ts::describeErrorResponse` extracts a
   readable message client-side).
7. Financial totals are consistent and traceable — `get_dashboard_summary` is
   verified to compose entirely from other tools' own functions with no
   duplicated arithmetic (per its own docstring and `docs/TOOLS.md`), which is
   the correctness pattern the rest of AG2 holds every tool to.
8. OWNER authentication and the `apps/web`↔`apps/api` signed-JWT trust boundary
   remain enforced exactly as built in D1–D1.1 and Phase 10 (`require_auth` on
   both `/chat` and `/tools` — verified in `apps/api/main.py`).
9. Conversations persist (verified: Prisma `Conversation`/`Message` models,
   unchanged by this plan).
10. Dashboard and chat work on desktop and mobile (AG5 evaluates; no fixed
    mobile-blocking defect is known at plan-writing time — none was found in
    this review).
11. Docker stack starts reliably (unchanged mechanism from Delivery's own
    validated Compose stack; re-verified per AG phase as needed).
12. Production environment variables are documented (`.env.example` at repo
    root is verified current for all AI-Agent-relevant variables:
    `OPENAI_API_KEY`, `OPENAI_MODEL`, `DATA_BACKEND`, `ODOO_*`,
    `CORS_ALLOWED_ORIGINS`, `API_AUTH_SECRET`).
13. No secrets are committed (standing rule, re-verified at the end of every
    phase per `docs/PROJECT_DEVELOPMENT_GUIDE.md`).
14. Automated tests **and an evaluation suite** pass — the evaluation suite is
    AG1's deliverable and does not exist yet; this is a completion
    **requirement**, not a completed fact.
15. Internal acceptance testing (AG8) is completed with recorded evidence —
    not claimed until it has actually happened, mirroring the honesty
    standard Delivery D9 was held to.

---

## 4. Gap Analysis

Every gap below cites the concrete file/test/doc evidence it is based on — no
invented problems.

### Critical
**None found.** No evidence of data loss, a security bypass, a broken
read-only guarantee, or an unusable core workflow. The read-only enforcement
(`src/services/odoo_security.py`, three independent layers per
`SECURITY_REVIEW.md`), the auth boundary (`apps/api/auth.py::require_auth`),
and the core chat round-trip are all verified in place and tested.

### High
- **H1 — No evaluation suite exists for routing/tool-selection accuracy.**
  ✅ **Resolved by AG1** (`docs/AI_AGENT_EVALUATION_BASELINE.md`) — 75-case
  dataset, 30 deterministic tests, one live baseline run. Note: resolving H1
  built the measurement, not a fix — it surfaced concrete misrouting/ambiguity
  findings in `_detect_intent()`'s keyword rules that remain open, owned by AG3.
- **H2 — No per-tool business-logic correctness tests.** Evidence: §2's table;
  `tests/test_provider.py` verifies data-shape parity, not computed correctness
  (e.g., no test asserts `get_collection_priorities`'s documented
  `score = overdue_amount * (1 + days_overdue/30) + overdue_invoice_count *
  100` formula actually produces that score against known mock rows). Blocks
  §3.1/§3.7.
- **H3 — No live-Odoo validation has ever been run or recorded.** Evidence:
  `tests/test_odoo_connection.py` has zero `test_*` functions (a manual
  script, not CI-collected); no document records a comparison against a real
  Odoo report. Blocks §3.1 directly — this is AG4's entire purpose.

### Medium
- **M1 — The rule-based fallback router has a hardcoded "current date."**
  Evidence: `src/agent/router.py` lines 51–52: `_THIS_MONTH = 6` /
  `_THIS_YEAR = 2026`, used whenever the OpenAI path is unavailable (missing
  key, network/API failure — a real, documented fallback path, not
  hypothetical). As of this plan's writing the actual date is later than June
  2026, so the fallback is **already stale** for any "this month"/"last month"
  query. The OpenAI path itself is unaffected — `src/services/openai_service.py`
  computes `CURRENT_DATE = date.today().isoformat()` dynamically. Contained
  blast radius (fallback-only) keeps this Medium, not High.
- **M2 — No client-side request timeout on `/chat`.** Evidence:
  `apps/web/lib/api.ts::request()` uses a plain `fetch` with no
  `AbortController`/timeout; a hung OpenAI call leaves the UI showing
  "Thinking…" indefinitely with no user-facing timeout error. Affects §3.6 and
  is AG6's concern.
- **M3 — No structured request/error logging or request correlation.**
  Evidence: `apps/api/main.py` uses a single bare `logger.exception(...)` call
  on failure; no request id, no latency measurement, no token/cost visibility.
  `docs/NEXT_PHASES.md` already named this gap for the platform generally;
  this plan scopes it specifically to the AI Agent's own request path (AG6).
- **M4 — Six of fourteen tools have no one-click quick action.** Evidence:
  `apps/web/lib/quickActions.ts` has 8 entries; `get_customer_balance`,
  `get_customer_summary`, `get_payment_history`, `get_customer_statement`,
  `get_collection_priorities`, and `get_top_selling_products` are reachable
  only via free-text chat. Minor discoverability gap, not a functional defect
  (AG5).
- **M5 — Production deployment readiness for the Next.js/FastAPI stack is
  incomplete and self-documented as such.** Evidence:
  `DEPLOYMENT.md`'s own header: "this stack has not been deployed to a public
  host yet"; `PRODUCTION_CHECKLIST.md` is scoped to the older Streamlit
  prototype only, not the current SaaS stack. Matches `docs/NEXT_PHASES.md`'s
  existing risk register (secrets in `.env` files, no rotation story, SQLite
  under concurrent load). AG7's scope.
- **M6 — No PostgreSQL-vs-SQLite decision has been made for AI Agent
  production use.** Evidence: `docs/DELIVERY_MANAGEMENT_PLAN.md` §6 and
  `docs/REMAINING_PROJECT_ROADMAP.md`'s Track 4 (P2) already flag this for the
  platform generally; AG7 must decide whether the AI Agent v1 release
  specifically requires it or can ship on SQLite (this plan's position, per
  §5 AG7: evaluate, do not assume).

### Low
- **L1 — No dedicated component test for `ResponseCard` or `ChatInput`.**
  Evidence: `apps/web/tests/` has `api.test.ts` (client) and `display.test.tsx`
  (TopBar/Sidebar) but no test file imports `ResponseCard` or `ChatInput`
  directly; their behavior is currently only indirectly covered through
  manual verification. Cosmetic/coverage gap, not a known defect.
- **L2 — `export_customer_statement` (CSV/Excel export) is Streamlit-only.**
  Evidence: §2. Not a defect — a legitimate scope boundary — but worth an
  explicit product decision (AG5) on whether `apps/web` should ever expose it,
  rather than it silently staying Streamlit-only by accident.
- **L3 — CI has no evaluation-suite job.** Evidence:
  `.github/workflows/ci.yml`'s two jobs (`frontend`, `backend`) run
  lint/build/unit-tests only; once AG1's evaluation suite exists, CI does not
  yet run it. Natural follow-on once AG1 ships, not a defect today.

Categories from the task's checklist with **no gap found**, evidence noted:
**F (error handling)** — readable errors verified end-to-end (§3.6). **H
(live Odoo reliability)** covered under H3 above, not a separate finding.
**I/J (frontend usability/mobile)** — no known blocking defect; AG5 is
discovery, not a fix-list. **K (performance/latency)** — no measured baseline
exists yet (that absence itself is folded into AG6, not listed as a separate
Medium since no evidence of an actual latency problem exists, only an absence
of measurement). **L (cost controls)** — `ENABLE_AI_INSIGHTS=False` already
avoids a second, optional OpenAI call by default; no runaway-cost mechanism
found, but no cost *visibility* exists either (M3 covers this).

---

## 5. Recommended Phases

Each phase follows the standard template
(`docs/PROJECT_DEVELOPMENT_GUIDE.md` §4's planning gate). AG-prefixed to stay
distinct from Delivery's D-prefixed phases. Sequence is evidence-based: AG1
must exist before AG2/AG3 can be measured against anything, and AG4 (live Odoo)
is independent of AG2/AG3 so could run in parallel if resourced — but this plan
recommends sequential execution to keep each phase's diff reviewable, matching
every prior phase in this project's history.

### AG1 — Capability Inventory and Evaluation Baseline

> **✅ Complete (2026-07-14).** Full results, methodology, coverage matrix, and
> every finding: `docs/AI_AGENT_EVALUATION_BASELINE.md`. Summary: 75-case
> dataset (`tests/evals/agent_cases.json`) covering all 14 registered tools in
> English and Arabic; 30 deterministic Layer A tests (`tests/evals/test_*.py`,
> 0 network calls) plus one live, model-assisted Layer B run against the
> real configured model (probe-substituted — no business logic or live Odoo
> ever executed) — 68/72 executed cases passed. 4 real, reproducible routing
> defects found on the live path and 5 more proven deterministically on the
> rule-based fallback path (including the known stale `_THIS_MONTH`/
> `_THIS_YEAR` constants) — all left unfixed and handed to AG3 per this
> phase's explicit scope. The evaluation set landed under `tests/evals/`
> (this plan's original sketch below said `tests/evaluation/`) to match the
> detailed AG1 task instructions actually given; `scripts/run_agent_evaluation.py`
> is the one CLI entry point. No file in `src/`, `app.py`,
> `apps/api/main.py`, or `apps/api/schemas.py` was modified — boundary check
> verified empty. AG2 has **not** been started.

- **Module owner:** `src/`, `tests/` (read-only discovery — the evaluation set
  itself is data/fixtures, not production code)
- **Goal:** a fixed, versioned evaluation set covering all 14 tools, in
  English and Arabic, across happy-path/ambiguous/unknown/follow-up/
  date-sensitive cases, with expected tool + expected parameters + required
  facts recorded — closing H1.
- **Operational problem solved:** today, "does routing still work correctly"
  has no answer except manual spot-checking; every future change to
  `router.py`, `prompts.py`, or a tool signature is a regression risk with no
  safety net.
- **Dependencies:** none beyond the current registry (§2).
- **Exact scope:** build the evaluation matrix (§6 defines its shape) as a
  structured, runnable fixture; a harness that runs each case through
  `route_query()` (both the OpenAI path, if a key is available, and the
  rule-based fallback) and reports routing/parameter matches; record results,
  do not yet fix anything found unless it is a proven Critical/High defect
  matching this plan's own bug-fix discipline (mirroring D9's policy).
- **Explicit out-of-scope:** changing any tool's business logic; adding new
  tools; Arabic-language UI work (only query *input* in Arabic is tested here,
  not localized output).
- **Expected files:** `tests/evaluation/` (new — fixture set + harness),
  possibly `docs/AI_AGENT_EVALUATION.md` documenting how to run it.
- **Security requirements:** none beyond existing (read-only, no new surface).
- **Tests required:** the harness itself is the deliverable; it must be
  runnable offline against `DATA_BACKEND=mock` without an OpenAI key (the
  rule-based path) so CI can run at least that subset without live-API cost.
- **Docker/runtime validation:** not required (a `pytest`/script-level
  deliverable).
- **Documentation updates:** `docs/AI_AGENT_COMPLETION_PLAN.md` (this file)
  §5 status, `docs/TOOLS.md` cross-reference if useful.
- **Stop conditions:** if building the evaluation set surfaces a tool whose
  documented behavior and actual behavior already disagree materially, stop
  and report before continuing (that disagreement becomes the first AG2/AG3
  finding, not something to quietly work around in the fixture).
- **Release impact:** required for Milestone A.

### AG2 — Tool Contract and Response Consistency

> **✅ Complete (2026-07-15).** Full contract specification, per-defect record,
> error taxonomy, and deferrals: `docs/AI_AGENT_TOOL_CONTRACTS.md`. Summary:
> 13 proven defects fixed (D1–D13), all in `src/tools/`, `src/utils/`,
> `src/agent/tool_schemas.py`, `src/data/` — including a severe one found
> during test-writing (D13: a whitespace-padded customer name returned a
> silently wrong QAR 0.00 balance because filtering used the raw argument
> instead of the canonical name after lookup). 95 new offline contract tests
> in `tests/contracts/` (schema↔implementation, result shapes, formatters,
> error taxonomy); 186 total Python tests green. AG1 model-assisted regression
> re-run: 68/72 — equal aggregate, no new stable routing failure, and one
> stable AG1 failure (`OV-EN-01`) now passes 4/4 after the D6 schema-
> description fix. Routing rules, fallback date constants, financial formulas,
> `route_query()`'s envelope, `app.py`, `apps/api`, and `apps/web` are all
> unchanged. AG3 has **not** been started. Note on H2: this phase covers
> contract/shape/formatting correctness; per-tool *business-formula*
> verification remains with AG4's live-data validation.

- **Module owner:** `src/tools/`, `src/utils/formatting.py`
- **Goal:** standardize success/error presentation, currency/date formatting,
  and tool-context labeling across all 14 tools; verify every schema in
  `tool_schemas.py` still matches its implementation's actual signature.
- **Operational problem solved:** closes H2 (§4) — establishes correctness
  confidence without a full rewrite.
- **Dependencies:** AG1 (use its evaluation set to detect regressions from any
  change made here).
- **Exact scope:** audit-and-fix only where AG1 evidence or a direct
  code/doc mismatch proves a defect; do not rewrite tools with no proven
  issue.
- **Explicit out-of-scope:** rewriting all 14 tools speculatively; changing
  any financial calculation without a validated business-rule reason.
- **Expected files:** targeted edits within `src/tools/*.py`,
  `src/utils/formatting.py`; `tests/` additions for whatever was fixed.
- **Security requirements:** none beyond existing.
- **Tests required:** a regression test per fixed defect, plus the missing
  per-tool correctness tests H2 identified (against `src/data/mock_data.py`'s
  fixed, known dataset).
- **Docker/runtime validation:** `python -m pytest tests/ apps/api/tests -v`.
- **Documentation updates:** `docs/TOOLS.md` if any documented behavior
  changed.
- **Stop conditions:** if a "consistency" fix would change a financial total's
  value, stop — that requires an explicitly validated business-rule decision,
  not a formatting phase's default authority.
- **Release impact:** required for Milestone A.

### AG3 — Routing and Multi-Turn Reliability

> **✅ Complete (2026-07-15).** Full record: `docs/AI_AGENT_ROUTING.md`.
> Summary: every routing defect documented in AG1 is fixed — the hardcoded
> fallback date constants are gone (all relative dates derive from
> `date.today()` at call time), analytic phrasings are disambiguated by the
> named entity's type, the unknown-customer broadening is guarded, the
> fallback gained Arabic coverage for all 14 intents and now reads customers/
> products through the provider (no longer mock-bound), and `SYSTEM_PROMPT`
> gained explicit ROUTING RULES that fixed all three remaining live-path
> failures (missed-payments terminology, follow-up resolution,
> overdue-vs-collections arbitration). **Model-assisted evaluation: 72/72
> executed cases pass (was 68/72), each previously-failing case verified 4/4
> stable.** 98-test permanent regression suite added (`tests/routing/`);
> 285 Python tests green. Tool schemas, outputs, business formulas, API
> responses, `app.py`, `apps/api`, `apps/web` all unchanged. AG4 has **not**
> been started. Known deliberate limitations (stateless fallback, static
> NO_CUSTOMER_MSG examples) are documented with justification in
> `docs/AI_AGENT_ROUTING.md` §5.

- **Module owner:** `src/agent/router.py`, `src/agent/prompts.py`
- **Goal:** fix routing defects AG1 found; handle ambiguous customer/product
  names safely; validate the lightweight-history mechanism's actual behavior
  (not just its presence); add regression tests.
- **Operational problem solved:** closes H1's remaining half (fixing what AG1
  found, not just measuring it) and M1 (the fallback's hardcoded date).
- **Dependencies:** AG1 (needs its findings to have anything to fix).
- **Exact scope:** routing/prompt fixes proven by AG1 evidence; replace
  `_THIS_MONTH`/`_THIS_YEAR`'s hardcoded values with `date.today()`-derived
  ones (the OpenAI path's own already-correct pattern); verify
  `filter_history`/`buildLightweightHistory` actually prevent context leakage
  in practice, not just by code inspection.
- **Explicit out-of-scope:** autonomous multi-agent orchestration, adding new
  routing intents beyond the existing 14 tools.
- **Expected files:** `src/agent/router.py`, `src/agent/prompts.py`,
  regression tests in `tests/`.
- **Security requirements:** none beyond existing.
- **Tests required:** every AG1-found routing defect gets a named regression
  test; the date-hardcoding fix gets a test that fails before the fix
  (mock `date.today()`) and passes after.
- **Docker/runtime validation:** re-run AG1's harness end-to-end.
- **Documentation updates:** `docs/TOOLS.md`/`docs/API_CONTRACT.md` if routing
  behavior visibly changed.
- **Stop conditions:** if a routing fix would require restructuring
  `route_query()`'s public contract (`{tool, parameters, result}`), stop —
  that contract is depended on by both `app.py` and `apps/api/main.py` and a
  breaking change is a cross-cutting decision, not an AG3-scoped one.
- **Release impact:** required for Milestone A.

### AG4 — Live Odoo Data Accuracy Validation

> **⛔ BLOCKED — awaiting live Odoo access (2026-07-16).** Full record:
> `docs/AG4_LIVE_ODOO_VALIDATION.md`. The configured Odoo Online instance no
> longer exists — every endpoint including `/web/login` returns 404 (expired/
> deleted trial database). All safe preparation work is complete: the opt-in
> live validation harness (`tests/live_odoo/`, 26 cases, `live_odoo` marker,
> RUN_LIVE_ODOO=1 gate, independent reference calculations incl. a
> receivable-ledger cross-check), the canonical 14-tool validation inventory,
> the as-implemented accounting-decision record, and four pre-identified
> candidate discrepancies (AG4-Q1…Q4) encoded as live assertions. **No tool
> is claimed PASS.** To unblock: provision a reachable Odoo instance with the
> dedicated read-only user, update `.env`, then
> `RUN_LIVE_ODOO=1 python -m pytest tests/live_odoo -v`. AG5 has not started.

- **Module owner:** `src/services/odoo_service.py`, `src/data/provider.py`
  (read-only validation against them — no changes expected unless a proven
  normalization defect is found)
- **Goal:** validate each tool's Odoo-backed output against known Odoo
  reports/records; document any accepted differences; produce a repeatable
  checklist — closing H3.
- **Operational problem solved:** the entire Odoo-backend code path (§2's
  "Live Odoo validation status") has never been checked against real data;
  this is the single largest unverified assumption in the whole product.
- **Dependencies:** a real Odoo instance with a read-only credential
  (`docs/ODOO_READONLY_USER.md` already documents how to provision one);
  independent of AG1–AG3, could run in parallel if resourced.
- **Exact scope:** for each of the 5 provider entities (customers, invoices,
  payments, products, sales), compare provider output against the Odoo UI's
  own reports for the same data; record totals/counts/dates/overdue-logic/
  pagination agreement or documented discrepancy.
- **Explicit out-of-scope:** any Odoo write of any kind, at any layer, ever;
  changing `enforce_read_only()` or the security-gateway model.
- **Expected files:** `docs/AI_AGENT_LIVE_VALIDATION.md` (new — the checklist
  and its results), possibly small `provider.py` normalization fixes if a
  genuine mismatch is found (e.g. a payment-state edge case).
- **Security requirements:** read-only preserved and re-verified
  (`tests/test_security.py` must stay green; `git diff --stat -- src/` scoped
  strictly to any proven normalization fix, nothing broader).
- **Tests required:** any normalization fix gets a test against mock data
  reproducing the discrepancy pattern (live-Odoo itself can't be a CI
  dependency).
- **Docker/runtime validation:** run the full tool set against
  `DATA_BACKEND=odoo` in the Docker stack, not just locally.
- **Documentation updates:** `docs/TOOLS.md` if any field's meaning needed
  clarifying; `docs/ODOO_READONLY_USER.md` if provisioning needed a note.
- **Stop conditions:** if a discrepancy traces to a business-rule ambiguity
  (e.g. what exactly counts as "overdue" in the specific Odoo instance's
  configuration) — stop and get that rule confirmed before encoding it in
  code.
- **Release impact:** required for Milestone A.

### AG5 — AI Assistant Product UX Completion

- **Module owner:** `apps/web`
- **Goal:** finish the OWNER AI workspace's polish — address M4 (missing
  quick actions), L1 (component test coverage), L2 (export-tool product
  decision); improve mobile behavior only where AG1–AG4 or direct testing
  proves an actual problem exists.
- **Operational problem solved:** discoverability (6 tools with no one-click
  entry point) and a documented, deliberate decision on `export_customer_statement`'s
  future rather than an accidental permanent gap.
- **Dependencies:** none blocking; best done after AG2/AG3 so quick actions
  point at tools already known-correct.
- **Exact scope:** add quick actions for the 6 uncovered tools if judged
  useful; add `ResponseCard`/`ChatInput` tests; make an explicit, documented
  decision on the export tool (port it to `apps/web`, or explicitly defer with
  a reason — either is acceptable, silence is not).
- **Explicit out-of-scope:** a platform-wide redesign with no evidence
  driving it (matches the Delivery-track precedent of never redesigning
  without a proven defect).
- **Expected files:** `apps/web/lib/quickActions.ts`,
  `apps/web/tests/ResponseCard.test.tsx` / `ChatInput.test.tsx` (new),
  `docs/AI_AGENT_COMPLETION_PLAN.md` update recording the export decision.
- **Security requirements:** none beyond existing.
- **Tests required:** new component tests; any UX change gets a test.
- **Docker/runtime validation:** manual verification per
  `docs/PROJECT_DEVELOPMENT_GUIDE.md`'s UI-change rule (start the dev server,
  exercise it in a browser).
- **Documentation updates:** none required beyond the export decision, unless
  quick actions changed.
- **Stop conditions:** if "improve mobile behavior" starts requiring a layout
  redesign with no specific proven defect driving it — stop, that's scope
  creep against this phase's own explicit boundary.
- **Release impact:** required for Milestone B.

### AG6 — Observability, Cost, and Reliability

- **Module owner:** `apps/api`, `apps/web/lib/api.ts`
- **Goal:** close M2 (client timeout) and M3 (structured logging); add
  latency measurement and, where available, token/cost visibility; a safe
  retry/timeout policy for the OpenAI call itself.
- **Operational problem solved:** today a hung request has no user-facing
  timeout and an operator has no structured signal when `/chat` is failing
  except a user complaint — the exact risk `docs/NEXT_PHASES.md` already
  named for the platform generally, scoped here specifically to the AI
  Agent's request path.
- **Dependencies:** none blocking.
- **Exact scope:** `AbortController`-based client timeout in
  `apps/web/lib/api.ts`; structured log fields (request id, tool name,
  latency, success/failure) in `apps/api/main.py::chat`; an explicit,
  documented timeout on the `OpenAI()` client construction in
  `openai_service.py`.
- **Explicit out-of-scope:** a full observability platform (Datadog/Sentry/
  etc. integration) — structured logs only, matching Delivery's own P4 scope
  boundary in `docs/REMAINING_PROJECT_ROADMAP.md`.
- **Expected files:** `apps/api/main.py`, `apps/web/lib/api.ts`,
  `src/services/openai_service.py`.
- **Security requirements:** **must not log secrets, full JWTs, passwords, or
  sensitive business data** — same rule Delivery's P4 and D9 phases already
  committed to; log tool names/timing/outcome, never raw query content beyond
  what's already truncated for error logs today.
- **Tests required:** timeout behavior tested (mocked slow response); log
  output format tested where reasonably testable.
- **Docker/runtime validation:** verify logs appear correctly in the running
  Docker stack; verify a simulated timeout produces a readable UI error.
- **Documentation updates:** `docs/API_CONTRACT.md` if timeout behavior is
  externally visible.
- **Stop conditions:** if cost visibility would require sending query content
  to a third-party observability service — stop, that's a data-handling
  decision beyond this phase's authority.
- **Release impact:** required for Milestone B.

### AG7 — Production Deployment Readiness

- **Module owner:** deployment tooling, `apps/web`, `apps/api`
- **Goal:** close M5 — a real production checklist for the current Next.js/
  FastAPI stack (not the outdated Streamlit-only `PRODUCTION_CHECKLIST.md`);
  decide M6 (Postgres necessity) explicitly rather than by default.
- **Operational problem solved:** `DEPLOYMENT.md` and
  `PRODUCTION_CHECKLIST.md` are both honest about not covering the current
  stack — this phase closes that honestly-documented gap.
- **Dependencies:** AG1–AG6 substantially complete (deploying an unvalidated
  agent is not "production readiness").
- **Exact scope:** HTTPS/reverse-proxy guidance, secret management beyond
  `.env` files, backup/recovery for `Conversation`/`User` data, deployment
  smoke tests, rollback instructions, an operational runbook — matching the
  shape of Delivery's own P1–P5 track in `docs/REMAINING_PROJECT_ROADMAP.md`
  (this is the AI-Agent-specific equivalent, not a duplicate of it).
- **Explicit out-of-scope:** actually migrating to Postgres in this phase —
  evaluate whether it's *required* for the v1 release; only migrate if that
  evaluation concludes SQLite is genuinely insufficient (matches "do not
  automatically migrate databases during the planning phase").
- **Expected files:** `docs/AI_AGENT_PRODUCTION_CHECKLIST.md` (new, or a
  rewritten `PRODUCTION_CHECKLIST.md` scoped to the current stack — decide at
  phase start), no application code changes expected unless the evaluation
  proves one necessary.
- **Security requirements:** secrets never committed; any new
  environment/deployment documentation uses placeholders only.
- **Tests required:** deployment smoke-test script, if one doesn't already
  exist in a usable form.
- **Docker/runtime validation:** full `docker compose -f
  docker-compose.saas.yml build && up`, confirm both containers healthy, a
  full restart-persistence check (matches every prior phase's standard).
- **Documentation updates:** the new checklist; `docs/NEXT_PHASES.md` and
  `docs/REMAINING_PROJECT_ROADMAP.md` cross-referenced, not duplicated.
- **Stop conditions:** if production readiness reveals a need for
  multi-instance horizontal scaling — stop, that's Track 4/5 territory in the
  Delivery roadmap's terms, not an AG7-scoped decision.
- **Release impact:** required for Milestone B.

### AG8 — Internal Acceptance and AI Agent v1 Release

- **Module owner:** whole product (evaluation, not code)
- **Goal:** a controlled internal evaluation with real business questions;
  record failures and corrections; confirm the OWNER can use the assistant
  without developer help; define and check acceptance criteria; mark AI Agent
  v1 released **only with recorded evidence** — same honesty discipline
  Delivery D9 was explicitly held to.
- **Operational problem solved:** without this phase, "v1 complete" would be
  a claim, not a verified fact.
- **Dependencies:** AG1–AG7 complete.
- **Exact scope:** run the acceptance session; log every finding (mirroring
  the Delivery pilot's feedback-table discipline: severity-classified,
  reusable format); fix only Critical/High findings automatically, document
  the rest.
- **Explicit out-of-scope:** any new feature discovered "would be nice" during
  acceptance testing — logged for a future phase, not implemented here.
- **Expected files:** `docs/AI_AGENT_ACCEPTANCE_LOG.md` (new).
- **Security requirements:** no real secrets/credentials in the acceptance
  log.
- **Tests required:** a regression test for every Critical/High fix made
  during this phase.
- **Docker/runtime validation:** the acceptance session itself runs against
  the full Docker stack.
- **Documentation updates:** this file's Milestone C status; the acceptance
  log.
- **Stop conditions:** if acceptance reveals a Critical defect — stop, fix,
  re-validate before declaring release, exactly as every prior phase's
  bug-fix discipline requires.
- **Release impact:** **is** Milestone C.

---

## 6. Tool Evaluation Matrix (design)

AG1's deliverable is a runnable fixture set shaped like this table (no rows
are populated here — populating it with fabricated "live results" is exactly
what this plan was told not to do):

| Field | Purpose |
|---|---|
| `test_id` | Stable identifier, e.g. `EN-001`, `AR-014` |
| `language` | `en` / `ar` |
| `query` | The natural-language input |
| `conversation_history` | Prior turns, if this is a follow-up case (empty for standalone) |
| `expected_tool` | The tool name `route_query()` should select |
| `expected_parameters` | Expected extracted arguments |
| `required_facts` | Facts that MUST appear in the result (e.g. a specific balance figure from mock data) |
| `prohibited_claims` | Things the answer must NOT assert (e.g. a number not present in the tool's raw result) |
| `expected_error_behavior` | For deliberately-broken cases: what a safe failure looks like |
| `data_source` | `mock` or `odoo` (most cases run against mock for CI stability) |
| `validation_status` | `not_run` / `pass` / `fail` / `accepted_deviation` |
| `notes` | Free text |

**Required categories** (each gets multiple `test_id`s, not populated here):
happy path; ambiguous entity (a name matching multiple/partial customers or
products); unknown entity; missing required parameter; Arabic wording
variations; English wording variations; follow-up questions (using the
lightweight-history mechanism); date-sensitive questions (spanning the M1
fallback-date issue); large/paginated data; Odoo unavailable (simulated
provider failure); OpenAI unavailable (forces the rule-based fallback,
directly exercising M1/AG3's fix); unauthorized request (no/invalid token);
rate-limited request (exercises `apps/api/main.py`'s existing 30/60s limiter).

---

## 7. Release Milestones

### Milestone A — Core Agent Correctness
- **Required phases:** AG1, AG2, AG3, AG4.
- **Acceptance criteria:** the evaluation suite exists and passes at an
  agreed threshold; every tool's output is verified correct against both mock
  and live Odoo data; the fallback-router date bug (M1) is fixed with a
  regression test.
- **Intentionally excluded:** UX polish (AG5), observability (AG6),
  production deployment (AG7) — Milestone A is about correctness, not
  presentation or operations.

### Milestone B — Product-Ready AI Workspace
- **Required phases:** Milestone A, AG5, AG6, AG7.
- **Acceptance criteria:** quick actions cover all tools judged worth one (or
  the gap is a documented deliberate choice); client-side timeout and
  structured logging exist; a current, accurate production checklist exists
  for the Next.js/FastAPI stack.
- **Intentionally excluded:** the acceptance session itself (AG8) — B is
  "ready to be evaluated," not "evaluated."

### Milestone C — Odoo AI Agent v1 Internal Release
- **Required phases:** Milestone B, AG8.
- **Acceptance criteria:** AG8's acceptance log shows no unresolved
  Critical/High findings; the OWNER can use the assistant without developer
  assistance (recorded, not assumed).
- **Intentionally excluded (explicitly, per this plan's own scope boundary):**
  Delivery D9, OCR (any phase), Odoo writes, multi-tenancy, billing, public
  SaaS launch, background/autonomous agent actions. None of these gate the AI
  Agent v1 release.

---

## 8. Immediate Recommendation

**AG1 — Capability Inventory and Evaluation Baseline** is confirmed, against
the repository evidence gathered in §2 and §4, as the correct next phase: it
is the one piece of infrastructure every other AG phase depends on
(AG2/AG3/AG8 all need something to measure "did this get better or worse"
against), and no repository evidence suggests a different phase should go
first — AG4 (live Odoo) is the only phase independent enough to
parallelize, but this plan recommends sequential execution for the same
reviewability reason every prior phase in this project has used.

**AG1 is complete** — see the status marker in §5 and
`docs/AI_AGENT_EVALUATION_BASELINE.md` for the full record. AG2 is the
logical next phase but has **not** been started and requires its own
approval per the planning gate, same as every prior phase in this project.

---

## 9. Paused Delivery Work

- **Delivery D1–D8 are complete, tested (270 passing `apps/web` tests as of
  D8), and remain fully in place** — no Delivery file was touched to produce
  this plan (verified: `git diff --stat` against this plan's own commit
  touches only `docs/` and, if needed, this file's own creation).
- **D9 (Internal Pilot Readiness) is paused, not started.** No
  `docs/INTERNAL_DELIVERY_PILOT*.md` files exist; no human pilot has occurred;
  no claim to the contrary should ever be made (the same honesty rule D9's own
  instructions established).
- The Delivery module remains available and functional in the running stack —
  pausing D9 does not disable or degrade D1–D8's shipped functionality.
- **No Delivery file should change during AG-phase work** unless a Critical
  shared-platform regression is discovered (e.g. an auth/session change that
  would affect both product surfaces) — matching this document's own §10 stop
  conditions.

---

## 10. Stop Conditions

Future AI Agent implementation must stop and return to planning if:

- a phase unexpectedly requires Odoo writes
- a financial calculation would change without a validated business rule
  behind it
- `src/` would require a broad rewrite rather than a targeted fix
- a tool's documented contract and its implementation disagree in a way that
  can't be resolved by fixing the implementation alone (i.e. the contract
  itself is ambiguous and needs a product decision)
- live Odoo validation (AG4) reveals a discrepancy that can't be explained by
  a known, documented cause
- authentication or the read-only enforcement model would weaken in any way
- tests fail
- Docker validation fails
- secrets are detected in a diff
- Delivery, OCR, or SaaS work is being implemented accidentally under an
  AG-phase banner
- a major architecture decision appears that wasn't explicitly approved first

---

## Documentation Validation (performed before this file was committed)

- Every file/path cited above was read directly, not assumed:
  `src/agent/tool_registry.py`, `src/agent/tool_schemas.py`,
  `src/agent/router.py`, `src/agent/prompts.py`,
  `src/services/openai_service.py`, `src/data/provider.py`,
  `src/tools/export_tools.py`, `apps/api/main.py`, `apps/api/schemas.py`,
  `apps/web/components/DashboardClient.tsx`,
  `apps/web/components/ResponseCard.tsx`, `apps/web/lib/api.ts`,
  `apps/web/lib/history.ts`, `apps/web/lib/quickActions.ts`,
  `.github/workflows/ci.yml`, `docs/TOOLS.md`, `docs/API_CONTRACT.md`,
  `DEPLOYMENT.md`, `PRODUCTION_CHECKLIST.md`, `requirements-api.txt`,
  `.env.example`, `tests/*.py`, `apps/api/tests/*.py`, `apps/web/tests/*`.
- **Tool count verified as 14 by reading `TOOL_REGISTRY` directly** — not
  assumed from any prior document, per this phase's explicit instruction.
- Test commands verified current: `npm run lint` / `build` / `test` (apps/web,
  matches `.github/workflows/ci.yml`); `python -m pytest apps/api/tests -v`,
  `python -m pytest tests/ -v`, `python -m py_compile app.py apps/api/main.py
  apps/api/schemas.py` (matches CI exactly).
- Current Docker services verified: `docker-compose.saas.yml` defines exactly
  `api` and `web` (unchanged by Delivery D1–D8, unchanged by this plan).
- Delivery D9 confirmed to have zero uncommitted or committed files (§0).
