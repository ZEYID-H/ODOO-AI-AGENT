# Deployment Guide

This document covers taking the Odoo Business Intelligence Assistant from
"runs on my machine" to "accessible from a browser, no terminal required."

Deployment only — this does not change any business logic, analytics,
routing, or security code. See `SECURITY_REVIEW.md` for the security model,
unchanged by deployment.

---

## Platform Comparison

| Platform | Setup effort | Cost | Notes |
|---|---|---|---|
| **Streamlit Community Cloud** | Lowest — connect GitHub repo, add secrets, deploy | Free | Purpose-built for Streamlit apps. **Recommended.** |
| Railway | Low-medium — uses this repo's `Dockerfile` automatically | Free tier (credits), then paid | Good if you want Docker-based hosting with more control |
| Render | Low-medium — Docker or native Python web service | Free tier (cold starts), then paid | Similar tradeoffs to Railway |
| Azure / Google Cloud Run | Medium-high — cloud account, billing, IAM | Pay-per-use | Overkill for a single-instance BI assistant; use if you already run cloud infra |
| Docker + VPS | Highest — you manage the box, TLS, reverse proxy | Cost of the VPS | Full control, no vendor lock-in |

### Why Streamlit Community Cloud

The app is a single Streamlit process with no database, no background
workers, and no special infrastructure needs beyond outbound HTTPS to OpenAI
and your Odoo instance. Streamlit Cloud deploys directly from the GitHub repo
that's already pushed, needs zero Docker/infra knowledge, is free, and has a
built-in encrypted **Secrets** manager — exactly the env vars this app needs
(`OPENAI_API_KEY`, `ODOO_*`) never have to touch the terminal or a config
file on a server. It also supports restricting viewers to an email allow-list,
which is the simplest way to add a login gate in front of the app.

The **Dockerfile in this repo works identically on Railway, Render, Cloud
Run, or any VPS** if you outgrow Streamlit Cloud or want more control later.

---

## Option A — Streamlit Community Cloud (recommended)

1. Push this repository to GitHub (already done: `github.com/ZEYID-H/ODOO-AI-AGENT`).
2. Go to **share.streamlit.io** and sign in with GitHub.
3. **New app** → select this repo, branch `main`, main file path `app.py`.
4. Under **Advanced settings → Secrets**, paste (values, not just names):
   ```toml
   OPENAI_API_KEY = "sk-..."
   OPENAI_MODEL = "gpt-4o-mini"
   DATA_BACKEND = "odoo"
   ODOO_URL = "https://your-odoo-host"
   ODOO_DB = "your-db-name"
   ODOO_USERNAME = "AI_AGENT_READONLY"
   ODOO_PASSWORD = "your-api-key-or-password"
   EXPECTED_ODOO_USER = "AI_AGENT_READONLY"
   ```
5. Click **Deploy**. Streamlit Cloud installs `requirements.txt` and runs
   `streamlit run app.py` automatically — no Dockerfile needed for this path.
6. (Optional, for a login gate) **App settings → Sharing** → restrict viewers
   to specific email addresses.

You'll get a public URL of the form `https://<app-name>.streamlit.app`.

---

## Option B — Docker (Railway / Render / Cloud Run / VPS)

This repo includes a production `Dockerfile`, `.dockerignore`, and
`docker-compose.yml`.

### Build and run locally (verified working in this session)

```bash
docker build -t odoo-bi-assistant .
docker run --env-file .env -p 8501:8501 odoo-bi-assistant
# or, equivalently, one command:
docker compose up
```

Open **http://localhost:8501**.

### Deploy to Railway / Render

Both platforms auto-detect the `Dockerfile` when you connect the GitHub
repo:

1. Create a new service, point it at this repo.
2. Set the same environment variables as in Option A's secrets block (both
   platforms have an "Environment Variables" panel in the dashboard).
3. Expose port `8501`.
4. Deploy. Both platforms provide a public HTTPS URL automatically.

### Deploy to Google Cloud Run

```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/odoo-bi-assistant
gcloud run deploy odoo-bi-assistant \
  --image gcr.io/PROJECT_ID/odoo-bi-assistant \
  --port 8501 \
  --set-env-vars OPENAI_API_KEY=...,DATA_BACKEND=odoo,ODOO_URL=...,ODOO_DB=...,ODOO_USERNAME=AI_AGENT_READONLY,ODOO_PASSWORD=...,EXPECTED_ODOO_USER=AI_AGENT_READONLY
```

Cloud Run supports the websocket connections Streamlit needs; no extra flags required.

### Deploy to a VPS

```bash
git clone https://github.com/ZEYID-H/ODOO-AI-AGENT.git
cd ODOO-AI-AGENT
cp .env.example .env   # fill in real values
docker compose up -d
```
Put a reverse proxy (nginx/Caddy) in front for TLS and a domain name; this
part is standard for any containerized app and isn't specific to this project.

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | For AI routing | Enables OpenAI function calling; without it the app runs on the deterministic rule-based fallback. |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini`. |
| `DATA_BACKEND` | No | `mock` (default) or `odoo` (live). |
| `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD` | For live mode | Odoo connection. `ODOO_USERNAME` must be the dedicated read-only account. |
| `EXPECTED_ODOO_USER` | For live mode | Startup refuses to run if `ODOO_USERNAME` doesn't match this — a safety net against accidentally using a privileged account. |

**Never commit real values.** `.env` is git-ignored; only `.env.example`
(placeholders) is tracked. Every platform above has its own secrets/env-var
UI — credentials never need to live in a file on a server.

---

## Startup Command

Local / any host with Python installed:
```bash
streamlit run app.py
```

Docker (one command):
```bash
docker compose up
```

Both start the identical app — same code path, same tools, same security
layers.

---

## Health Check

Streamlit exposes a built-in health endpoint: **`/_stcore/health`** (returns
`ok` with HTTP 200 when the process is alive). The `Dockerfile` wires this
into Docker's own `HEALTHCHECK`, so `docker ps` and `docker inspect` report
container health automatically — no custom health-check code was added to
the application itself.

```bash
curl http://localhost:8501/_stcore/health   # -> ok
docker inspect --format='{{.State.Health.Status}}' <container>   # -> healthy
```

Most platforms (Railway, Render, Cloud Run) also use HTTP 200 on the root
path as their own default health signal, which Streamlit already serves.

---

## Performance Notes (unchanged from Phase 5)

- `st.cache_data` on the dashboard, dashboard charts, and statement export
  helpers avoids duplicate Odoo round-trips on every rerun.
- The router's OpenAI→fallback design means a slow/unavailable OpenAI call
  degrades to instant deterministic routing rather than hanging.
- Odoo reads are paginated (no record cap), keeping individual requests
  bounded regardless of dataset size.

No changes were made to caching or routing in this phase — this section
documents what already exists.

---

## What Was Actually Verified in This Session

Everything below was run against the **exact Docker image** described in
this document, not just the local dev environment:

- `docker build` succeeds from a clean checkout.
- Container health check reports `healthy`.
- All 9 required business queries (Customer Insights, Product Insights,
  Business Alerts, Top Debtors, Dashboard, Sales Summary, Top Products,
  Overdue Invoices, Unpaid Invoices) return the correct tool and live Odoo
  data — executed **inside the running container** via `docker exec`.
- Full test suite (`test_security.py` 10/10, `test_provider.py`,
  `test_date_filters.py`, `test_routing.py`) passes **inside the container**.
- No `.env` file or secret values are present in the built image or its
  layer history (checked via `docker run --entrypoint sh` and
  `docker history --no-trunc`).
- Browser verification via headless Chromium against the running container:
  landing page and a full quick-question round trip both render correctly
  with zero console errors.

**Not done in this session (requires your own account/credentials):**
actually clicking "Deploy" on Streamlit Cloud / Railway / Render / a cloud
provider console. Everything above is the evidence that doing so will work;
the exact steps to get a public URL are in Option A/B above.
