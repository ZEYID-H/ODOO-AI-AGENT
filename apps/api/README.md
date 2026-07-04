# Odoo BI API — FastAPI Backend

A thin HTTP wrapper around the existing Python business logic in `src/`.
This service contains no business logic of its own: every request is
translated into a call to `route_query()` (unchanged, from
`src/agent/router.py`) and its result is returned as JSON.

See `docs/SAAS_MIGRATION_PLAN.md` for the full migration context.

## Install

From the repo root:

```bash
pip install -r requirements-api.txt
```

## Run locally

From the repo root (so `src/` resolves correctly):

```bash
uvicorn apps.api.main:app --reload
```

The API serves at **http://localhost:8000**. Interactive docs at
**http://localhost:8000/docs**.

Set the same environment variables as the Streamlit app (`.env` at the repo
root — `OPENAI_API_KEY`, `DATA_BACKEND`, `ODOO_*`; see `.env.example`). No new
secret files are introduced by this service.

## Endpoints

### `GET /health`
```json
{"status": "ok", "service": "odoo-bi-api"}
```

### `GET /tools`
```json
{"count": 14, "tools": ["get_business_alerts", "get_customer_balance", ...]}
```

### `POST /chat`
Request:
```json
{
  "query": "show business alerts",
  "history": [{"role": "user", "content": "..."}]
}
```
`history` is optional and is always re-filtered server-side to short,
non-tabular text before being passed to `route_query` — even if a client
sends a full tool-output table back, it will be collapsed to
`"(Prior tool output omitted.)"` rather than re-entering LLM context.

Response (always this shape, success or failure):
```json
{
  "success": true,
  "tool": "get_business_alerts",
  "parameters": {},
  "result": "## Business Alerts\n..."
}
```

On any internal error, `success` is `false` and `result` is a short, friendly
message — never a stack trace.

## Tests

```bash
pip install -r requirements-api.txt
python -m pytest apps/api/tests -v
```

## What this service does NOT do

- No business logic, no tool logic, no direct Odoo access — everything
  flows through the unchanged `route_query()`.
- No database, no auth, no billing, no multi-tenancy (see
  `docs/SAAS_MIGRATION_PLAN.md` for what's explicitly deferred).
- Does not affect the existing Streamlit app (`app.py`) in any way; both can
  run side by side.
