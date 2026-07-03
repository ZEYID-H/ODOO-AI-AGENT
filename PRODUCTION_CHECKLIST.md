# Production Readiness Checklist

Status as of this repository snapshot. Items are marked done only where
verified in this session; unchecked items are genuine gaps, not omissions.

## Configuration

- [x] Backend selectable via `DATA_BACKEND` env var (`mock` / `odoo`), default `mock`.
- [x] OpenAI model configurable via `OPENAI_MODEL`, sensible default (`gpt-4o-mini`).
- [x] Dedicated-user enforcement via `EXPECTED_ODOO_USER`.
- [ ] Centralized config validation report (currently split across `odoo_config.py` startup checks; no single "show effective config" command).

## Environment Variables

- [x] `.env.example` documents every variable (`OPENAI_API_KEY`, `OPENAI_MODEL`,
      `DATA_BACKEND`, `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD`,
      `EXPECTED_ODOO_USER`).
- [x] `.env` is git-ignored; never committed (verified: not in `git ls-files`).
- [x] No secrets committed anywhere in the tracked tree (verified: `.env.example`
      contains placeholders only).

## Security

- [x] Read-only enforced at 3 independent layers (Odoo ACLs, code whitelist,
      startup validation) plus audit logging — see `SECURITY_REVIEW.md`.
- [x] Single XML-RPC gateway (`odoo_service.py`); enforced by
      `test_no_direct_xmlrpc_outside_gateway`.
- [x] `SecurityException` raised (not silently swallowed) on any non-read
      method attempt.
- [x] Startup refuses to run with `READ_ONLY_MODE=False`, missing credentials,
      or a non-dedicated Odoo user.
- [ ] Production deployment currently authenticates as a developer account for
      testing, not yet the dedicated `AI_AGENT_READONLY` user — **must be
      switched before going live** (see `SECURITY_REVIEW.md` §8).
- [ ] Audit log (`security_audit.log`) is local-file only; not yet shipped to
      a remote/append-only sink for tamper resistance.

## Testing

- [x] `tests/test_provider.py` — mock-mode data integrity.
- [x] `tests/test_security.py` — 10/10, read-only guarantees.
- [x] `tests/test_date_filters.py` — date-range parser.
- [x] `test_routing.py` — end-to-end rule-based routing.
- [x] `tests/test_odoo_connection.py` — live Odoo read verification (manual,
      requires real credentials; not part of CI by design).
- [ ] No automated CI pipeline (GitHub Actions) configured yet.
- [ ] No unit tests for individual analytics modules (Modules D/E/F) beyond
      the manual live-validation performed during development.

## Deployment

- [ ] Not yet deployed to any hosting target (Streamlit Cloud, Render,
      Railway, etc.).
- [ ] No containerization (Dockerfile) yet.
- [ ] No process manager / health check for production Streamlit hosting.

## Performance

- [x] Odoo reads are paginated (no fixed record cap; pages until a short page
      returns).
- [x] Dashboard and export results are cached with `st.cache_data` to avoid
      duplicate Odoo round-trips on rerun.
- [x] "Inactive customer" alert detection uses a single pass over sales data
      instead of one Odoo fetch per customer (avoids an N-way round-trip
      multiplier).
- [ ] No load testing performed against a large Odoo dataset (current
      validation dataset: ~91 customers, ~1700 sales lines).

## Error Handling

- [x] Router degrades to rule-based fallback on any OpenAI failure (missing
      key, rate limit, network error) rather than surfacing an exception.
- [x] UI wraps the processing call in a try/except and shows a friendly error
      card — no stack traces exposed to the user.
- [x] Tools return `{"error": ...}` dicts (not exceptions) for expected
      not-found cases (unknown customer, unmatched product).

## Documentation

- [x] `README.md` — overview, architecture, setup, security, tools, structure.
- [x] `SECURITY_REVIEW.md` — full threat model.
- [x] `docs/ODOO_READONLY_USER.md` — primary security control setup guide.
- [x] `docs/TOOLS.md` — full tool reference.
- [x] `docs/USER_GUIDE.md` — example prompts by category.
- [x] `DEMO.md` — 5-minute walkthrough script.
- [x] `PRODUCTION_CHECKLIST.md` — this file.

## Git

- [x] `.gitignore` excludes `.env`, `venv/`, `__pycache__/`, `*.pyc`,
      `security_audit.log`, `exports/`, generated `*.xlsx`/`*.csv`.
- [x] No secrets, credentials, or API keys in tracked history.
- [x] Clean working tree at each phase (verified via `git status --short`
      before every commit this session).

## README

- [x] Problem statement, architecture diagram, tech stack, features.
- [x] Security model summary with link to full threat model.
- [x] Installation, environment variables, running locally, connecting to Odoo.
- [x] Project structure, known limitations, future improvements, license, author.

## Screenshots

- [ ] Not yet captured/committed — README has placeholder image links under
      `docs/screenshots/` pending real captures.

## Demo

- [x] `DEMO.md` written and ready to follow live.
- [ ] No recorded video walkthrough yet.

---

## Summary

**Ready for a controlled/internal demo today** (mock or live-read-only mode,
security layers fully verified). **Not yet ready for unattended production
deployment** — the two blocking items are switching the live Odoo
authentication from a developer account to the dedicated `AI_AGENT_READONLY`
user, and standing up an actual hosting target. Everything else on this list
is either done or a reasonable, explicitly-tracked gap.
