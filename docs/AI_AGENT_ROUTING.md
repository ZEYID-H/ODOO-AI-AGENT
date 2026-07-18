# AI Agent Routing — AG3

**Status:** AG3 complete. **Date:** 2026-07-15. **Scope:** routing only —
`src/agent/router.py`, `src/agent/prompts.py`, and the shared date-phrase
vocabulary in `src/utils/date_filters.py`. No tool schema, tool output,
business formula, API response, or formatting rule changed (all AG2-frozen).

**Headline result:** the model-assisted routing evaluation went from **68/72**
(AG1/AG2 baseline) to **72/72** — every routing failure documented during AG1
is fixed, each verified stable across 4 consecutive runs. The deterministic
fallback suite grew from 30 to 128 routing-related tests (all green).

---

## 1. Architecture (unchanged shape, hardened internals)

`route_query(query, history) -> {tool, parameters, result}` still has exactly
two layers:

1. **OpenAI Function Calling (primary, semantic).** The model resolves intent
   from meaning, guided by the tool schemas and — new in AG3 — an explicit
   `ROUTING RULES` block in `SYSTEM_PROMPT` that arbitrates every known
   overlap between tools. This is where "intent dominates keyword matching"
   lives: the primary path has no keyword rules at all.
2. **Rule-based fallback (deterministic, offline, stateless).** Used only when
   OpenAI is unavailable or fails. AG3 rebuilt its internals: entity-aware
   disambiguation, provider-backed extraction, dynamic dates, Arabic coverage,
   an unknown-customer guard, and a write-intent guard.

## 2. Issues Fixed (with root cause and approach)

| # | AG1 issue | Root cause | Fix | Regression test |
|---|---|---|---|---|
| 1 | Hardcoded fallback dates (`_THIS_MONTH=6/_THIS_YEAR=2026`) misdated "this/last month" | constants written once, never derived from the clock | constants deleted; `_extract_period()` derives from `date.today()` at call time | `test_no_hardcoded_date_constants_remain`, `test_relative_periods_track_the_real_clock` |
| 2 | "last quarter" silently became "this month" on the fallback | unparsed phrases fell through to the stale default, and `parameters` reported month/year values that weren't even used | period text now takes precedence when parseable; `parameters` state the REAL applied range (`{"period": "01 Apr 2026 – 30 Jun 2026"}`); the current-month default applies only when no date phrase exists at all | `test_parsed_period_is_reported_honestly_in_parameters`, `test_fallback_last_quarter_is_actually_filtered_not_silently_this_month` |
| 3 | "How is APPLE MART doing?" → product insights (error); "Tell me about Fresh Apples" → customer insights (dead end) | keyword lists checked in fixed order with no knowledge of what entity was named | `_resolve_analytic_ambiguity()`: for analytic phrasings the **entity type decides** — known customer → customer insights, known product → product insights; keywords only break ties | `test_ambiguous_query_matrix` (12 phrasings), `test_entity_type_decides_between_customer_and_product_analytics` |
| 4 | Unknown "for X" in unpaid invoices silently broadened to ALL customers | `_extract_customer()` returns `None` for unrecognized names, and `None` legitimately means "no filter" | `_names_unmatched_customer()` guard: "for <TARGET>" where TARGET is not a known customer, a date phrase, a product, or an explicit "all" → clear `NO_CUSTOMER_MSG` instead of a confidently wrong scope | `test_unknown_customer_in_unpaid_invoices_never_broadens` + 3 edge tests |
| 5 | Zero Arabic coverage in the fallback | keyword lists were English-only | Arabic keywords for all 14 intents, Arabic month names, Arabic relative phrases (هذا الشهر / الشهر الماضي), Arabic-aware normalization | `test_arabic_intent_matrix_covers_all_14_tools` (14 queries) |
| 6 | Fallback extraction was mock-bound (`mock_data.CUSTOMERS` imported directly) | routing layer bypassed the provider abstraction | `_extract_customer()`/`_match_product()` read through `provider.get_customers()/get_products()` — whatever backend is active | `test_customer_extraction_reads_through_the_provider` |
| 7 | LIVE: "Any missed payments recently?" → `get_business_alerts` | no arbitration guidance between the three overdue-adjacent tools | `SYSTEM_PROMPT` ROUTING RULES: missed/late/past-due → `get_overdue_invoices`; collections only for "who to chase"; alerts only for broad health checks | live: 4/4 PASS; prompt pinned by `test_system_prompt_carries_overdue_disambiguation_guidance` |
| 8 | LIVE: follow-up "Show unpaid invoices too" re-answered the previous question | no follow-up guidance; model anchored on the tool named in the collapsed history note | ROUTING RULES: resolve references from history, then call the tool the NEW request asks for — with this exact scenario as the worked example | live: 4/4 PASS; `test_system_prompt_carries_follow_up_resolution_guidance` |
| 9 | LIVE: "Which customers have overdue invoices?" flip-flopped between overdue and collections | both schemas legitimately claim overdue-customer questions | ROUTING RULES names this exact phrasing → `get_overdue_invoices` | live: 4/4 PASS (both `OV-EN-01` and `GLOBAL-OPENAI-UNAVAIL-02`) |

Additional hardening beyond the documented issues:

- **Write-intent guard:** delete/create/update/cancel/void (+ Arabic
  equivalents) short-circuit to `unknown` before any keyword can match — the
  read-only guarantee now holds at the intent layer by construction, not by
  keyword accident (`test_backward_compatible_routing` write cases).
- **Entity extraction robustness:** punctuation → space normalization with
  token-boundary matching, so `Apple-Mart`, `'APPLE MART'`, `apple mart.`,
  `Apple Mart LLC`, `Apple Mart's` all extract; longest-name-wins prevents a
  short customer name shadowing a longer one (11-variant parametrized test).
- **Intent coverage gaps closed:** "Analyze X", "insights about X", "Show X
  invoices", "best sellers", "business metrics", "risk level" — all previously
  `unknown` on the fallback.

## 3. Date Resolution (single vocabulary, fully dynamic)

`src/utils/date_filters.py::parse_date_range` is the one date vocabulary for
both routing and tools. AG3 added: `current/previous month`,
`current/previous quarter`, `current/previous year`, `last/past N days`,
`month to date`/`mtd`, `year to date`/`ytd`. Already present: today,
yesterday, this/last week/month/quarter/year, explicit ISO ranges,
month-with-explicit-year (AG2), bare month names. Nothing anywhere resolves a
relative date from a constant; every phrase has a parametrized test
(`test_every_documented_relative_phrase_parses`).

## 4. Intent-over-Keywords: how the requirement is met

- The **primary** path is an LLM — genuinely semantic, now with explicit
  arbitration rules for every overlap AG1 measured.
- The **fallback** cannot be an LLM (its entire job is working when the LLM
  doesn't), so it approximates intent with *entity-aware* resolution: the
  named entity's type overrides the raw keyword collision, and honest
  refusals (`NO_CUSTOMER_MSG`/`UNKNOWN_INTENT_MSG`) replace confident wrong
  answers where certainty is impossible. "Confidence before selecting a tool"
  = a tool is chosen only when both an intent and (where required) a verified
  entity agree.

## 5. Remaining Limitations (deliberate, documented)

1. **The fallback is stateless.** Follow-ups ("their payment history") route
   on literal text only. Reference resolution without an LLM would be
   guesswork; a wrong silent guess is worse than the current behavior (the
   query either routes on its own words or asks for the customer name).
   Pinned by `test_fallback_remains_stateless_by_design`.
2. **`NO_CUSTOMER_MSG` still lists the five demo customers.** Building it
   dynamically would call the provider at import time (an Odoo round-trip at
   startup) — deferred to AG5's UX pass alongside live-backend message
   accuracy.
3. **"What products does Apple Mart buy?"** has no precisely-matching tool;
   ROUTING RULES direct the model to `get_customer_summary` (invoice history)
   as the closest answer. A per-customer product breakdown would be a new
   tool — out of AG3 scope by definition.
4. **Arabic coverage is keyword-based**, tested against the AG1 dataset's 14
   Arabic queries plus variants; it does not attempt full Arabic NLP (that is
   what the primary path is for). Alef/hamza variants are covered only where
   tested.
5. **Fallback Odoo-mode extraction cost:** `_extract_customer` reads the full
   customer list per query (one gateway call in Odoo mode). Acceptable at
   current scale; noting for AG6's performance pass.

## 6. Test Inventory

- `tests/routing/test_ag3_regressions.py` — **98 tests**: one per fixed
  defect, 12-case ambiguity matrix, 14-case Arabic matrix, 11 entity
  variants, 14 date phrases, 27-case backward-compatibility sweep, envelope
  and statelessness pins.
- `tests/evals/test_registry_coverage.py` — AG1's defect-evidence tests
  rewritten as fixed-behavior regression tests (30 tests).
- Model-assisted: `python scripts/run_agent_evaluation.py` → **72/72**
  executed cases (75 total; 3 deliberately skipped: 2 HTTP-contract
  cross-references, 1 live-Odoo placeholder for AG4).

## 7. Validation Summary

285 Python tests green (`tests/` + `apps/api/tests`), frontend suite
unchanged-and-green, Docker runtime verified — see the AG3 phase report in
the project history for the full checklist.
