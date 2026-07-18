# AG3 Routing Baseline — Freeze Record (AG3.5)

## 1. Baseline Identity

| Field | Value |
|---|---|
| Milestone | AG3 — Routing Hardening & Intent Resolution (frozen by AG3.5) |
| Freeze date | 2026-07-16 |
| Branch | `main` |
| **Code-behavior baseline commit** | `c874f81` ("AG3: routing hardening and intent resolution") |
| **Tagged freeze commit** | the commit carrying this document (docs + one eval-harness oracle fix — see §5; **zero functional code differs from `c874f81`**) |
| Remote state at freeze | local `main` == `origin/main`, working tree clean, no unpushed commits |
| Tag | `v0.3-routing-stable` (annotated; verified absent locally and on origin before creation) |

Purpose: a pinned, reproducible reference point so AG4's live-Odoo
data-validation findings can be separated from routing regressions — any
future routing question can be answered by diffing against this tag.

## 2. Test Evidence (all re-run from the clean tree at freeze time)

| Suite | Command | Result | Pass | Fail | Skip | Notes |
|---|---|---|---|---|---|---|
| Routing regressions (AG3) | `python -m pytest tests/routing -q` | ✅ | 98 | 0 | 0 | deterministic, offline |
| Full standalone Python (evals + contracts + provider + security + dates + routing) | `python -m pytest tests/ -q` | ✅ | 241 | 0 | 0 | includes the 98 above |
| API tests | `python -m pytest apps/api/tests -q` | ✅ | 44 | 0 | 0 | 2 dependency deprecation warnings, pre-existing |
| Syntax gate | `python -m py_compile app.py apps/api/main.py apps/api/schemas.py` | ✅ | — | 0 | — | |
| Model-assisted routing eval | `python scripts/run_agent_evaluation.py --fail-on-mismatch` | ✅ | **72** | 0 | 3 | model `gpt-5.4-mini`; 3 skips are by design (2 HTTP-contract cross-refs, 1 live-Odoo placeholder for AG4) |
| Web lint | `npm run lint` (apps/web) | ✅ | — | 0 | — | |
| Production build | `npm run build` (apps/web) | ✅ | — | 0 | — | "Compiled successfully" |
| Web tests | `npm run test` (apps/web) | ✅ | 270 (22 files) | 0 | 0 | |
| Docker runtime | `docker compose -f docker-compose.saas.yml build && up -d` | ✅ | — | 0 | — | both containers healthy; `/health` ok; unauthenticated `/tools` → 401; `/login` → 200; stack torn down after |

**Total: 285 deterministic Python tests, 270 web tests, 72/72 executed
evaluation cases — zero failures.**

Model-eval nondeterminism note (recorded, not hidden): across three full
freeze runs, one borderline case (`SS-AR-01`) failed once — the model chose
the **correct tool and correct period** but wrote it as `period="2026-06"`,
a format the harness's `period_scoped_to` assertion didn't recognize as
"June 2026". This was a test-oracle gap, not a routing error; the assertion
now accepts bare `YYYY-MM` (§5). After the oracle fix: `SS-AR-01` 3/3 in
isolation and the full suite 72/72 clean.

## 3. Scope Verification

Verified by `git diff --stat c8a3c1b..c874f81 -- <path>` per surface — all
of the following show **zero changes** across the entire AG3 range:

- tool schemas (`src/agent/tool_schemas.py`) and registry (`tool_registry.py`)
- tool implementations (`src/tools/`) and business logic
- formatting/response contracts (`src/utils/formatting.py`)
- provider data logic (`src/data/`) and the Odoo gateway (`src/services/`)
- API contracts and authentication (`apps/api/`)
- the entire web app incl. Delivery Management D1–D8, auth, Prisma schema (`apps/web/`)
- Streamlit prototype (`app.py`), dependencies, Docker/deploy config, CI (`.github/`)

AG3's actual surface: `src/agent/router.py`, `src/agent/prompts.py`,
`src/utils/date_filters.py` (date-phrase vocabulary), tests, docs — exactly
the approved scope. All 9 AG1-documented routing defects are fixed with named
regression tests (`docs/AI_AGENT_ROUTING.md` §2 maps issue → root cause →
fix → test). **AG4 has not started**: no live-Odoo connection was made, no
credentials requested, `DATA_BACKEND` remains `mock`.

## 4. Known Limitations (carried forward verbatim in substance — `docs/AI_AGENT_ROUTING.md` §5)

1. The rule-based fallback is **stateless** — follow-ups route on literal
   text only (LLM-path capability by design; pinned by
   `test_fallback_remains_stateless_by_design`).
2. `NO_CUSTOMER_MSG` lists the five demo customers — accurate for mock,
   stale wording for live Odoo (deferred to AG5 with justification).
3. "What products does customer X buy?" has no exact tool; prompt guidance
   directs to `get_customer_summary`.
4. Arabic fallback coverage is keyword-based, tested against the dataset's
   14 Arabic queries + variants — full Arabic NLP remains the LLM path's job.
5. Odoo-mode fallback entity extraction reads the customer list per query
   (one gateway call) — performance note for AG6.
6. The model-assisted eval is inherently sampling-based; borderline phrasings
   can flip on rare runs even when routing guidance is correct (observed
   frequency during the freeze: 1 flip in 3×72 executions, and it was an
   oracle gap, not a routing miss).

## 5. Changes Made BY the Freeze Itself

Only two files beyond this document:

- `docs/AG3_ROUTING_BASELINE.md` — this evidence record (new).
- `tests/evals/evaluation_runner.py` — `_assert_period_scoped_to` now also
  accepts a bare `YYYY-MM` period reference (evaluation **harness** oracle,
  exercised only by the eval runner; not imported by any production module —
  `route_query`, tools, API, and UI behavior are byte-identical to
  `c874f81`).

## 6. Recovery Instructions

Inspect this baseline at any time (safe, read-only):

```bash
git fetch --tags origin
git log -1 v0.3-routing-stable
git diff v0.3-routing-stable            # what changed since the baseline
```

Check out the baseline temporarily (safe — detached HEAD, no branch moved):

```bash
git checkout v0.3-routing-stable
# ... inspect / run tests ...
git checkout main                        # return
```

Create a branch from the baseline (safe):

```bash
git checkout -b routing-baseline-work v0.3-routing-stable
```

> ⚠️ **Destructive** — only with explicit approval and after backing up:
> `git reset --hard v0.3-routing-stable` on `main` discards every commit and
> local change made after the baseline. Never combine with `push --force` on
> this repository (force-push is prohibited by project policy).

## 7. Security Verification

- Tracked env files: `.env.example`, `apps/web/.env.docker.example`,
  `apps/web/.env.local.example` — **placeholders only** (verified by content
  scan). No real `.env` file is tracked; all are git-ignored.
- Variables confirmed placeholder-only in tracked files: `OPENAI_API_KEY`,
  `ODOO_PASSWORD`, `API_AUTH_SECRET`, `AUTH_SECRET`, `SEED_*_PASSWORD`.
  (Names listed; values never printed.)
- Secret-pattern scan (API-key/private-key signatures) over all tracked
  files: no hits.
- No logs, database dumps, or customer exports tracked (`security_audit.log`,
  `exports/`, `tests/evals/results/` all git-ignored; eval-runner output
  contains tool names/parameters/latencies only — no keys, tokens, or
  business figures).
