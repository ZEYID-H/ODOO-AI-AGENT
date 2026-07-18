# AI Agent Evaluation Baseline — AG1

> **Post-AG3 comparison (2026-07-15) — current state.** After AG3's routing
> hardening (`docs/AI_AGENT_ROUTING.md`), the model-assisted suite scores
> **72/72 executed cases — zero routing failures** (75 total: 2 HTTP-contract
> cross-references and 1 live-Odoo placeholder remain deliberately
> unexecuted). All three stable AG1 failures — `GLOBAL-FOLLOWUP-01`,
> `GLOBAL-TERM-02`, `GLOBAL-OPENAI-UNAVAIL-02` — now pass, each re-verified
> 4/4 in isolated re-runs. The AG1 Layer A defect-evidence tests were
> rewritten as fixed-behavior regression tests, and a 98-test permanent
> routing suite was added (`tests/routing/test_ag3_regressions.py`). The AG1
> sections below remain as the historical record of what was originally
> measured; `agent_cases.json`'s `currentStatus` fields reflect the post-AG3
> run (74 PASS, 1 BLOCKED).

> **Post-AG2 comparison (2026-07-15).** The full model-assisted suite was
> re-run after AG2's contract/formatter fixes, same model (`gpt-5.4-mini`),
> same probe-substituted harness: **68/72 executed cases passed — equal to
> AG1's aggregate, with no new stable routing failure.** Case-level changes,
> both re-verified with 4 consecutive single-case re-runs:
>
> - `OV-EN-01` ("Which customers have overdue invoices?") — a stable AG1
>   FAIL — now **passes 4/4**, plausibly aided by AG2's fix to
>   `get_overdue_invoices`'s schema description (it falsely said "Takes no
>   arguments"; defect D6 in `docs/AI_AGENT_TOOL_CONTRACTS.md`). Not claimed
>   as certain causation; recorded as a measured improvement.
> - `SS-VAR-01` ("What's our sales performance?") failed once in the full AG2
>   run (routed to `get_dashboard_summary`) but **passes 4/4 on re-run**; the
>   schemas of both tools involved were untouched by AG2 — model
>   nondeterminism on a borderline phrasing, not a regression.
>
> Remaining stable failures — `GLOBAL-FOLLOWUP-01`, `GLOBAL-TERM-02`,
> `GLOBAL-OPENAI-UNAVAIL-02` — are the known AG1 findings, unchanged and still
> owned by AG3. Contract fixes vs formatter fixes vs unchanged routing
> failures are separated in `docs/AI_AGENT_TOOL_CONTRACTS.md` §§4, 13.
> One AG1 Layer A test was updated (not deleted) because it documented the
> pre-AG2 defective behavior of `get_unpaid_invoices` with an unknown
> customer: `tests/evals/test_registry_coverage.py::`
> `test_unknown_customer_now_errors_instead_of_silently_succeeding` now proves
> the fixed tool-level contract while still asserting the open router-level
> broadening (AG3). Layer A is now 30/30 green again.

**Status:** AG1 complete. **Run date:** 2026-07-14. **Scope:** measurement only — this phase
observes and records current routing/tool-selection behavior; it does not change it. No
production code (`src/`, `app.py`, `route_query()`, `TOOL_REGISTRY`, tool implementations,
tool schemas, the Odoo gateway, or `apps/api`/`apps/web` behavior) was modified to produce
this baseline.

---

## 1. Purpose and Scope

AG1 builds the first repeatable, evidence-based evaluation baseline for the Odoo AI Agent's
tool registry and routing behavior (`docs/AI_AGENT_COMPLETION_PLAN.md` §4, gap **H1**). Every
claim in this document is backed by either:

- a **deterministic test** that imports and calls real production code directly (no network,
  no OpenAI key required — reproducible by anyone, forever), or
- a **live, model-assisted run** against the real OpenAI API using this repository's actual
  configured model, with all 14 tools' real business logic replaced by inert probes so no
  business data is fabricated and no live Odoo call is ever possible.

Nothing here fixes a bug. Known issues are documented with an owning future phase (AG3–AG6)
and left exactly as found.

## 2. Verified Source-of-Truth

Re-verified directly against the running code (not assumed from prior documentation) at the
start of AG1:

- `TOOL_REGISTRY` (`src/agent/tool_registry.py`) contains **exactly 14 tools**:
  `get_business_alerts`, `get_collection_priorities`, `get_customer_balance`,
  `get_customer_insights`, `get_customer_statement`, `get_customer_summary`,
  `get_dashboard_summary`, `get_overdue_invoices`, `get_payment_history`,
  `get_product_insights`, `get_sales_summary`, `get_top_debtors`,
  `get_top_selling_products`, `get_unpaid_invoices`.
- `TOOL_SCHEMAS` (`src/agent/tool_schemas.py`) names match the registry exactly (`tool_names()
  == set(TOOL_REGISTRY)`), independently of `_validate_registry()`'s own import-time check.
- Every tool's real Python signature was read via `inspect.signature()`, not assumed from
  descriptions — several optional/required distinctions differ subtly from what a schema
  description alone implies (e.g. `get_unpaid_invoices(customer_name=None, period=None)` has
  **no required parameters** even though most queries name a customer).
- **Correction of a stale prior assumption:** the mock product catalog
  (`src/data/mock_data.py PRODUCTS`) uses plain names like `"Extra Virgin Olive Oil"` and
  `"Fresh Apples"` — not SKU-coded names like `"[OIL-16L-T] OLIVE OIL (16L TIN)"` that had been
  assumed in earlier, unverified planning notes. The dataset (§4) uses the real names.
- `OPENAI_API_KEY` is configured in this environment; `OPENAI_MODEL=gpt-5.4-mini` is set,
  which is what Layer B actually measured against — not the code's own fallback default of
  `gpt-4o-mini` (`src/services/openai_service.py::_DEFAULT_MODEL`). Worth a documentation note
  for whoever configured `.env`, but not a defect.
- Active data backend: `DATA_BACKEND` is unset, so `src/data/provider.py::_backend()` resolves
  to `"mock"` — no live Odoo call was possible even without probe substitution.
- Existing test suite before AG1 changes: **61 passed** (`apps/api/tests`: 44,
  `tests/`: 17), 0 failed — confirmed by direct execution, not assumed from prior summaries.

## 3. Evaluation Architecture

Two independent layers, as specified:

- **Layer A — deterministic, CI-safe, no external calls.** Three pytest files under
  `tests/evals/` that import production code directly and assert on real return values:
  `test_evaluation_dataset.py` (dataset structural integrity against the live registry/schemas),
  `test_registry_coverage.py` (direct proofs of specific behavior facts — the stale-date bug,
  ambiguous-entity mis-routing, the read-only guarantee, Arabic support, etc.), and
  `test_history_contract.py` (every case's `history` fixture already conforms to the
  lightweight `{role, content}` contract `apps/web`/`apps/api` enforce, checked using their
  own real filter functions, not a reimplementation). All 30 tests run in under 3 seconds with
  no network access and are automatically collected by the existing `python -m pytest tests/`
  CI step (`tests/evals/` is a subdirectory of `tests/`) — **no CI workflow change was needed
  or made.**

- **Layer B — model-assisted, opt-in, never touches live Odoo.** `tests/evals/evaluation_runner.py`
  calls the real, unmodified `route_query()` for each case. Every one of the 14 registered
  tools' `function` and `formatter` is temporarily replaced with an inert probe
  (`probe_registry()`, a context manager) for the duration of each call, then restored — whether
  the call succeeds or raises — via a `try/finally` around a saved copy of the original
  `TOOL_REGISTRY` entries. The patch lives only in the in-process dict; nothing is written to
  disk, and `route_query`/`run_agent`/`execute_tool` are never modified, only the dict values
  they look up at call time. Because the model's chosen tool name and extracted arguments come
  from `tool_call.function.name`/`arguments` **before** `execute_tool()` ever runs, the probe's
  own return value is irrelevant to what Layer B measures — routing and parameter extraction
  are fully decoupled from business-logic/formatting correctness (that's AG2/AG4's concern).
  Layer B is never run automatically; it requires an explicit invocation of
  `scripts/run_agent_evaluation.py` (or `python -m tests.evals.evaluation_runner`) and a
  configured `OPENAI_API_KEY`. If no key is available, it prints `BLOCKED` and exits non-zero
  — it never fabricates a result.

Only one runner implementation exists — `scripts/run_agent_evaluation.py` is a 20-line CLI
shim that imports and calls `tests/evals/evaluation_runner.py::main()`.

## 4. Dataset Design

`tests/evals/agent_cases.json` — a JSON array of case objects, one per line of coverage. Each
case has exactly these fields:

| Field | Meaning |
|---|---|
| `id` | Stable identifier, e.g. `CB-EN-01`. |
| `category` | One of the required coverage categories (§5). |
| `language` | `en`, `ar`, or `n/a` (HTTP-contract cases with no natural-language query). |
| `query` | The literal user text. |
| `history` | `[]` or a list of `{role, content}` turns, already in the lightweight, post-filter shape. |
| `expectedTool` | The tool name Layer B compares the real routing outcome against, or `assistant`/`unknown`/`n/a` for the documented non-tool outcomes those two paths use. |
| `targetTool` | Which of the 14 registered tools this case counts toward for coverage purposes — usually equal to `expectedTool`, explicit when it differs (e.g. a missing-parameter case that correctly expects no tool call at all). |
| `expectedParameters` | Illustrative; the authoritative check is `parameterAssertions`. |
| `parameterAssertions` | Typed assertions, evaluated by `evaluation_runner.py` (§10). |
| `requiredFacts` | Fact **categories** the answer should contain (e.g. `"outstanding_amount"`), never invented real values. |
| `prohibitedClaims` | Things a correct answer must never assert. |
| `expectedErrorBehavior` | Free text describing the verified current error/edge-case behavior, where applicable. |
| `dataMode` | `mock` (normal routing eval), `live_odoo` (documented, not executed — AG4), `api_contract` (HTTP-level, cross-referenced to existing tests, not executed by this runner). |
| `notes` | The evidence trail — how each behavioral claim was verified, with file/line references. |
| `currentStatus` | `NOT_RUN`, `PASS`, `FAIL`, `EXPECTED_FAIL`, `BLOCKED` — see §8 for how this was populated. |

No live financial figures are hardcoded anywhere in the dataset; `requiredFacts` names fact
*categories* only, per the explicit instruction not to invent totals.

## 5. Coverage Matrix

**75 total cases** — 59 English, 14 Arabic, 2 language `n/a` (HTTP-contract). Every one of the
14 registered tools has at least the required 4 cases (English direct, Arabic direct, a wording
variation, and a parameter-validation/entity-handling case), counted by `targetTool`:

| Tool | Cases | Tool | Cases |
|---|---|---|---|
| `get_business_alerts` | 4 | `get_overdue_invoices` | 7 |
| `get_collection_priorities` | 4 | `get_payment_history` | 5 |
| `get_customer_balance` | 6 | `get_product_insights` | 5 |
| `get_customer_insights` | 5 | `get_sales_summary` | 4 |
| `get_customer_statement` | 5 | `get_top_debtors` | 4 |
| `get_customer_summary` | 5 | `get_top_selling_products` | 5 |
| `get_dashboard_summary` | 5 | `get_unpaid_invoices` | 7 |

Global categories (all 14 required by the AG1 spec are present): ambiguous entity (2),
unknown customer (4, spread across tools) / unknown product (1), missing param (2), follow-up
with lightweight history (2), date-sensitive (4), overdue/unpaid terminology variation (3),
singular/plural (2), large/paginated intent (1), unsupported/write request (2), Odoo
unavailable (1, `BLOCKED` by design), OpenAI unavailable (3, proven deterministically in Layer
A), unauthorized API request (1, cross-referenced), rate-limited API request (1,
cross-referenced).

`tests/evals/test_evaluation_dataset.py::test_every_registered_tool_has_minimum_case_coverage`
enforces the 4-per-tool minimum and the "every tool appears at all" property against the live
`TOOL_REGISTRY` on every test run — the matrix above cannot silently drift stale.

## 6. How to Run

```bash
# Layer A — deterministic, no key needed, ~3s:
python -m pytest tests/evals/ -v

# Layer B — model-assisted, requires OPENAI_API_KEY:
python scripts/run_agent_evaluation.py                          # full suite
python scripts/run_agent_evaluation.py --case CB-EN-01           # one case
python scripts/run_agent_evaluation.py --tool get_customer_balance
python scripts/run_agent_evaluation.py --language ar
python scripts/run_agent_evaluation.py --category ambiguous_entity
python scripts/run_agent_evaluation.py --output tests/evals/results/run.json
python scripts/run_agent_evaluation.py --update-dataset --fail-on-mismatch
```

`--update-dataset` writes real PASS/FAIL back into `agent_cases.json`'s `currentStatus` field
for every case it actually executed; it never touches cases with `dataMode` in
`{live_odoo, api_contract}` (those are documented/cross-referenced, not live-measured by this
runner). `--output` results are written under `tests/evals/results/`, which is gitignored — ad
hoc re-runs are not committed; the reviewed baseline lives in this document and in the
dataset's own `currentStatus` fields.

## 7. Layer A Results

**30 of 30 passed**, 0 failed, ~2.7s, no network. Highlights (full list in
`tests/evals/test_registry_coverage.py`):

- Probe substitution patches and fully restores all 14 tools' functions/formatters, including
  when the wrapped code raises.
- The rule-based fallback (`_rule_based_route`) has **no `history` parameter** at all — proven
  by signature introspection — so it structurally cannot resolve any follow-up-with-history case;
  only the OpenAI path can.
- `_rule_based_route("What are the top selling products this month?")["parameters"] ==
  {"month": 6, "year": 2026}` — proves the stale hardcoded constants (`_THIS_MONTH=6,
  _THIS_YEAR=2026`, `src/agent/router.py` lines 51-52) are exactly what "this month" resolves to
  on the fallback path, regardless of the real date.
- `_rule_based_route("Sales summary for last quarter")` also silently defaults to the same
  stale constants — `_extract_period()` has no "last quarter" handling at all, so an
  unrecognized relative period is not reported as unrecognized; it is silently misreported as
  this month.
- `_detect_intent("How is APPLE MART doing?") == "product_insights"` and
  `_detect_intent("Tell me about Fresh Apples") == "customer_insights"` — both keyword-table
  mis-routings, each demonstrated end-to-end through `_rule_based_route()` to its real, wrong
  tool call.
- `_detect_intent()` returns `"unknown"` for both `"Delete the invoice for APPLE MART"` and
  `"Create a new invoice for APPLE MART for $5000"` — the read-only guarantee holds at the
  routing layer, not only at the Odoo gateway layer.
- The rule-based fallback has **zero Arabic keyword coverage** — an Arabic balance question
  containing the Latin-script customer name still extracts the customer via substring match,
  but intent detection returns `"unknown"` and the extracted customer is discarded.
- `get_unpaid_invoices(customer_name=None)` — direct proof that an unrecognized customer name
  silently broadens the routed query to **all customers'** unpaid invoices rather than erroring
  or returning zero rows, because the router's `_extract_customer()` returns `None` (not the
  literal unmatched string) for anything not in the 5-name mock list.

## 8. Layer B Results — Live Baseline Run

**Run against `gpt-5.4-mini`** (this environment's real configured `OPENAI_MODEL`), 2026-07-14,
`DATA_BACKEND=mock`, all 14 tools probe-substituted (no business logic executed, no live Odoo
possible).

| Outcome | Count | Notes |
|---|---|---|
| PASS | 70 | 68 executed + 2 `api_contract` cases cross-referenced to already-passing `apps/api` tests |
| FAIL | 4 | Real, reproducible routing findings — see below |
| BLOCKED | 1 | `GLOBAL-ODOO-UNAVAIL-01` — live-Odoo scenario, deliberately not executed (AG4) |

72 of 75 cases were actually executed (3 `SKIPPED` by design: 2 `api_contract`, 1 `live_odoo`)
→ **68/72 = 94.4% live pass rate** on this run. Average latency 989ms/case.

**The 4 real FAILs** (each re-verified reproducible by re-running the individual case):

1. **`OV-EN-01` / `GLOBAL-OPENAI-UNAVAIL-02`** — *"Which customers have overdue invoices?"*
   routes to `get_collection_priorities` instead of `get_overdue_invoices` on the live OpenAI
   path. The identical query correctly resolves to `get_overdue_invoices` on the deterministic
   rule-based fallback (Layer A, §7) — the OpenAI path is *less* accurate than the fallback for
   this exact phrasing. Both tools' schema descriptions mention "overdue" language, which likely
   causes the ambiguity.
2. **`GLOBAL-TERM-02`** — *"Any missed payments recently?"* routes to `get_business_alerts`
   instead of `get_overdue_invoices`, despite `"missed payment"` being one of the rule-based
   fallback's own matched keywords for `overdue_invoices` (`src/agent/router.py::_detect_intent`).
3. **`GLOBAL-FOLLOWUP-01`** — a two-turn history (`"How much does APPLE MART owe us?"` →
   `"(Provided get_customer_balance results.)"` → `"Show unpaid invoices too"`) re-routes to
   `get_customer_balance` again instead of `get_unpaid_invoices`, i.e. the follow-up intent
   ("too") is not picked up; possible anchoring on the literal tool name mentioned in the
   collapsed history note.

All four are genuine measured routing-accuracy gaps on the **currently active** path (OpenAI),
not dataset defects — each was independently re-run to confirm reproducibility. They are
explicitly **not fixed in AG1**; ownership: AG3 (routing behavior).

Two assertion-design corrections were made *during* AG1 after the first raw run surfaced them
(fixing the test oracle, not the system under test — see `tests/evals/evaluation_runner.py`'s
`period_resolved`/`period_scoped_to` assertion types and their docstrings): the tool schemas
document `period` (a free-text string) as taking priority over separate `month`/`year`
integers, and a live run showed the model correctly prefers `period` — the dataset's original
assertions wrongly required integers. Similarly, the OpenAI path's "no tool call, safe refusal"
sentinel is `tool="assistant"`, not the rule-based fallback's `"unknown"` string — both are
correct, safe outcomes on their respective paths; the dataset now expects the sentinel that
matches the currently-active path, with the other documented in `notes`.

## 9. Known Issues Discovered (documented, not fixed in AG1)

| # | Finding | Evidence | Owner |
|---|---|---|---|
| 1 | Rule-based fallback's `_THIS_MONTH=6, _THIS_YEAR=2026` constants are stale as of this run (2026-07-14) and silently misdate any "this month"/"last month" query whenever OpenAI is unavailable. | Layer A, §7 | AG3 |
| 2 | Unrecognized relative periods (e.g. "last quarter") silently default to the same stale this-month constants instead of being reported as unrecognized. | Layer A, §7 | AG3 |
| 3 | `"how is X doing/selling"` always routes to `get_product_insights` on the fallback, even for a customer. `"tell me about X"` always routes to `get_customer_insights`, even for a product. | Layer A, §7 | AG3 |
| 4 | An unrecognized customer name silently broadens `get_unpaid_invoices` to all customers instead of erroring or returning zero rows. | Layer A, §7 | AG3 (routing) / AG4 (business-logic ambiguity) |
| 5 | The rule-based fallback has zero Arabic support; Arabic-only queries always resolve to `"unknown"` even when a known customer name is embedded. | Layer A, §7 | AG3 |
| 6 | "Which customers have overdue invoices?" and "Any missed payments recently?" both misroute on the **live, currently-active** OpenAI path. | Layer B, §8 | AG3 |
| 7 | A simple two-turn "show X too" follow-up does not reliably resolve on the live OpenAI path. | Layer B, §8 | AG3 |
| 8 | `.env`'s configured `OPENAI_MODEL=gpt-5.4-mini` differs from the code's own documented fallback default (`gpt-4o-mini`). Not a defect — just worth noting so future baseline runs know which model they're actually measuring. | §2 | n/a (documentation) |

## 10. Assertion Vocabulary Reference

Implemented in `tests/evals/evaluation_runner.py::ASSERTION_HANDLERS`:

| Type | Passes when |
|---|---|
| `exact` | The parameter equals a given value exactly. |
| `case_insensitive_equals` | The parameter equals a given string, ignoring case. |
| `key_exists` | The parameter key is present in the routed call, regardless of value. |
| `key_absent` | The parameter key is absent (e.g. no `customer_name` filter was applied). |
| `allowed_values` | The parameter's value is one of a given set. |
| `numeric` | The parameter is an `int`/`float` (not `bool`). |
| `non_empty` | The parameter is present and truthy. |
| `period_resolved` | *(cross-key)* Either a non-empty `period` string, or numeric `month`+`year`, is present — added after the first live run showed both are valid per the tool schemas' own documented priority order, and hardcoding one over the other for a relative period would make the assertion itself go stale. |
| `period_scoped_to` | *(cross-key)* Like `period_resolved`, but also checks the resolved period actually names a specific, non-relative `(month, year)` given in the case — safe to hardcode only because the query names an explicit month, not a relative one. |

## 11. Security & Safety Notes

- No secrets, tokens, or full business results are logged by the runner — only tool names,
  extracted parameter dicts (already secret-free by construction), latency, and pass/fail.
- Probe substitution guarantees no tool's real business logic — and therefore no live Odoo
  call — ever executes during a Layer B run, independent of `DATA_BACKEND`.
- `tests/evals/results/` (raw per-run JSON) is gitignored; only this reviewed document and the
  dataset's own `currentStatus` fields are committed.
- No real customer/business data appears anywhere in the dataset — all values reference the 5
  existing mock customers and mock product catalog already used throughout the repo's test
  suite.

## 12. Regression Validation

| Check | Result |
|---|---|
| `python -m pytest apps/api/tests -v` | 44 passed (unchanged) |
| `python -m pytest tests/ -v` (includes the 30 new `tests/evals/` tests) | 47 passed (17 pre-existing + 30 new) |
| `python -m py_compile app.py apps/api/main.py apps/api/schemas.py tests/evals/evaluation_runner.py` | OK |
| Frontend (`npm run lint && npm run build && npm run test` in `apps/web`) | see final phase report |
| `prisma generate` / `prisma migrate status` | not applicable — AG1 touches no schema |
| Docker build/up + runtime checklist | see final phase report |

**91 total Python tests pass**, 0 failures, 0 skipped outside the 3 deliberately-not-executed
Layer B cases (§5/§8).

## 13. Boundary Compliance

Per `docs/PROJECT_DEVELOPMENT_GUIDE.md` §3, the standard boundary check:

```bash
git diff --stat -- src/ app.py apps/api/main.py apps/api/schemas.py
```

is expected to be **empty** for this phase — AG1 added new files under `tests/evals/`,
`scripts/`, and `docs/` plus one `.gitignore` addition; it did not modify any file in the
protected list. Verified as part of this phase's final report.

## 14. Limitations / Explicitly Out of Scope for AG1

- **No live-Odoo correctness validation** — `DATA_BACKEND=odoo` was never activated; probe
  substitution makes it structurally impossible for this runner to reach Odoo even if it were.
  Belongs to AG4.
- **No routing fixes** — every known issue in §9 is left exactly as found.
- **No business-calculation verification** — whether the mock/Odoo numbers themselves are
  correct is out of scope; Layer B only checks which tool was called and with what arguments,
  never the tool's output values. Belongs to AG4.
- **No UX changes** (missing quick actions, client timeouts) — belongs to AG5.
- **No structured logging / reliability work** — belongs to AG6.
- **No CI workflow changes** — Layer A is automatically covered by the existing `tests/`
  pytest step; no new job was added, none was needed.
- The two `api_contract` cases and the one `live_odoo` case are recorded as evidence
  cross-references / documented gaps, not executed by this runner — by design, not oversight.

## 15. Next Recommendation

Per `docs/AI_AGENT_COMPLETION_PLAN.md` §5, the next phase is **AG2** (tool output /
formatter correctness — gap **H2**, no dedicated per-tool business-logic test exists yet).
AG1's Layer B findings (§8, §9) additionally hand AG3 (routing behavior) four concrete,
reproducible live-routing defects and five deterministically-proven fallback-path defects to
address, whenever that phase begins — none of which are addressed here. **AG1 is complete;
AG2 has not been started, per instruction.**
