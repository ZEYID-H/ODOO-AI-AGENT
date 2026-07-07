# Odoo Business Intelligence Assistant

**A read-only, AI-powered Business Intelligence assistant for Odoo ERP.**
Ask business questions in plain English — customer health, product performance,
collections priority, sales trends, executive KPIs — and get back accurate,
formatted answers sourced live from Odoo. The assistant can **read** your ERP
data at any depth; it is **structurally incapable of changing it**.

---

## The Problem

Getting a straight answer out of an ERP usually means: know which module to
open, know which filter to apply, know which report to run, and still end up
exporting to Excel to actually answer the question ("who owes us the most
money and for how long?", "is one product too large a share of our revenue?").
Non-technical stakeholders — managers, collections staff, owners — either wait
on someone else to pull the report, or don't ask the question at all.

This project closes that gap: a natural-language interface in front of live
Odoo data, purpose-built for **business analysts and managers**, not
developers — with a security model that lets it be handed to anyone without
risking a single write to production data.

---

## Architecture

**Conceptual flow:**

```
User
  │
  ▼
Streamlit UI  (chat, dashboard, quick questions, exports)
  │
  ▼
LLM  (OpenAI function calling — chooses a tool + arguments from natural language)
  │
  ▼
Router  (orchestrator — OpenAI path, with a deterministic rule-based fallback)
  │
  ▼
Business Tools  (customer / product / sales / invoice / alerts analytics)
  │
  ▼
Read-Only Gateway  (the only file allowed to speak XML-RPC to Odoo)
  │
  ▼
Odoo  (search / search_read / read only)
```

**Layer by layer:**

| Layer | Responsibility |
|---|---|
| **Streamlit UI** (`app.py`) | Chat interface, Executive Dashboard, quick-question buttons, statement export downloads. Presentation only — no business logic. |
| **LLM** (`src/services/openai_service.py`) | Sends the question + tool schemas to OpenAI. The model selects a tool and extracts arguments (e.g. `get_customer_balance(customer_name="Apple Mart")`); it never touches Odoo directly. |
| **Router** (`src/agent/router.py`) | The single entry point (`route_query`). Tries the OpenAI path first; if the API is unavailable or fails, falls back to deterministic keyword-based routing so the app **never goes fully offline**. |
| **Business Tools** (`src/tools/`) | 14 read-only analytics functions (balances, statements, insights, alerts, dashboard, etc.) plus their markdown formatters. Pure Python — no direct Odoo access. |
| **Data Provider** (`src/data/provider.py`) | Backend switch: `DATA_BACKEND=mock` (offline demo data) or `DATA_BACKEND=odoo` (live). Normalizes Odoo records into the same schema the tools already expect. |
| **Read-Only Gateway** (`src/services/odoo_service.py`) | The *only* module permitted to open an XML-RPC connection to Odoo. Every call is gated through the security layer before it runs. |
| **Odoo** | The ERP itself, reached only via `search` / `search_read` / `read`. |

---

## Technology Stack

| Layer | Technology |
|---|---|
| Language | Python 3.11+ |
| UI | Streamlit |
| AI | OpenAI API (Function Calling) |
| ERP Integration | Odoo XML-RPC |
| Data (dev/offline) | In-memory mock dataset |
| Export | CSV, Excel (openpyxl) |
| Charts | Streamlit native (`st.bar_chart`) over pandas |

No external database, message queue, or vector store — deliberately simple.

---

## Features

- **Natural-language querying** over live Odoo data via OpenAI function calling, with a deterministic offline fallback.
- **Customer Analytics** — balances, statements, lifetime value, purchase recency, risk level.
- **Product Analytics** — revenue, units sold, revenue share, exact-or-aggregated SKU matching.
- **Business Alerts** — proactive risk/opportunity detection (overdue customers, large invoices, inactive accounts, product concentration).
- **Collections Assistant** — prioritized follow-up list with a transparent scoring formula.
- **Executive Dashboard** — KPIs and top-5 charts in one view.
- **Natural-language date filters** — "this month", "last quarter", "between 2026-01-01 and 2026-03-31", etc.
- **Statement export** — CSV and Excel, generated on demand from the same data as the chat answer.
- **Conversational memory** — lightweight, text-only; ERP figures are always fetched fresh, never recalled from memory.

---

## Security Model

**The assistant is an ERP Analyst, not an ERP Operator.** It can read every
figure it's given access to; it cannot create, edit, delete, post, confirm,
reconcile, or validate anything in Odoo — even if the LLM hallucinates,
mis-selects a tool, or is prompt-injected.

Four independent layers enforce this, in order of authority:

1. **Dedicated Odoo user (primary)** — the agent authenticates as a
   purpose-built account (`AI_AGENT_READONLY`) whose Odoo ACLs grant `read`
   only, on a fixed list of models. Documented in
   [`docs/ODOO_READONLY_USER.md`](docs/ODOO_READONLY_USER.md).
2. **Code-level whitelist (secondary)** — `src/services/odoo_security.py`
   allows exactly `{search, search_read, read}` and rejects everything else
   (`create`, `write`, `unlink`, `action_post`, `reconcile`, …) with a
   `SecurityException`, regardless of what the ORM/gateway is asked to do.
3. **Startup validation (tertiary)** — the app refuses to start if
   `READ_ONLY_MODE` is off, credentials are missing, or the configured user
   isn't the dedicated read-only account.
4. **Audit logging (detection, not prevention)** — every Odoo call, allowed or
   blocked, is logged with timestamp, user, session ID, model, method, and
   decision.

Full threat model, attack vectors, and mitigations: [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md).

---

## AI Workflow

1. The user asks a question in the Streamlit chat (or clicks a quick-question button).
2. The router sends the question — plus a lightweight, text-only conversation history — to OpenAI with the 14 available tool schemas.
3. OpenAI selects a tool and extracts arguments (e.g. a customer or product name, an optional time period).
4. The router executes that tool through the registry, which calls the read-only gateway.
5. The tool's own formatter renders the result as markdown (tables, currency, dates) — the model never invents figures; it only routes.
6. If OpenAI is unavailable, rate-limited, or errors, the router transparently falls back to deterministic keyword routing — same tools, same formatters, same answer.

---

## Business Analytics Capabilities

| Category | Capability |
|---|---|
| Customers | Balance, full account summary, payment history, statement of account, deep analytics (lifetime revenue, recency, risk) |
| Debt & Collections | Top debtors ranking, prioritized collection worklist with recommended actions |
| Invoices | Unpaid invoices, overdue invoices (grouped by customer), optional date filtering |
| Products | Top sellers, per-product analytics with exact/aggregated SKU matching and revenue share |
| Sales | Period sales summary, natural-language date ranges |
| Management | Executive dashboard, proactive business alerts (risk + opportunity) |
| Export | Customer statements to CSV/Excel |

---

## Tool List

14 tools, one-to-one with `TOOL_REGISTRY` in `src/agent/tool_registry.py`.

| # | Tool | Purpose | Typical Questions | Returns |
|---|---|---|---|---|
| 1 | `get_customer_balance` | Outstanding balance for one customer | "How much does Apple Mart owe?" | Balance, overdue amount, open invoices, credit info |
| 2 | `get_customer_summary` | Full account overview | "Customer summary for Apple Mart" | Contact info, totals, invoice & payment history |
| 3 | `get_payment_history` | Payments made by a customer | "Payment history for Apple Mart" | Payment list, total paid |
| 4 | `get_customer_statement` | Chronological statement of account | "Customer statement for Apple Mart this year" | Ledger (invoices+payments), running balance, reconciliation note |
| 5 | `get_top_debtors` | Rank customers by outstanding balance | "Who owes us the most money?" | Ranked debtor list |
| 6 | `get_customer_insights` | Deep customer analytics | "Customer insights for Apple Mart" | Lifetime revenue, AOV, recency, risk level |
| 7 | `get_collection_priorities` | Prioritized follow-up list | "Who should we follow up with?" | Priority-scored customer list + action |
| 8 | `get_unpaid_invoices` | Unpaid + overdue invoices | "Show unpaid invoices" | Invoice list, total outstanding |
| 9 | `get_overdue_invoices` | Invoices past due, by customer | "Show overdue invoices this month" | Overdue list grouped by customer |
| 10 | `get_top_selling_products` | Top products by revenue | "Top selling products this month" | Ranked product list with category, revenue, units |
| 11 | `get_product_insights` | Deep product analytics | "How is Olive Oil selling?" | Revenue, units, customer count, revenue share, matched SKUs |
| 12 | `get_sales_summary` | Sales performance for a period | "Sales summary for last quarter" | Revenue, transactions, avg order, top customers/products |
| 13 | `get_dashboard_summary` | Executive KPI rollup | "Show dashboard" | Revenue, receivables, overdue, top debtor/product, counts |
| 14 | `get_business_alerts` | Proactive risk/opportunity alerts | "What should I worry about?" | Ranked alerts: overdue customers, large invoices, inactivity, concentration, opportunities |

Full detail (parameters, return schema) in [`docs/TOOLS.md`](docs/TOOLS.md).

---

## Screenshots

> Screenshots are not yet committed to the repository. Placeholders below —
> replace with real captures from `streamlit run app.py`.

**Home Screen**
![Home Screen](docs/screenshots/home.png)

**Executive Dashboard**
![Dashboard](docs/screenshots/dashboard.png)

**Customer Insights**
![Customer Insights](docs/screenshots/customer_insights.png)

**Product Insights**
![Product Insights](docs/screenshots/product_insights.png)

**Business Alerts**
![Business Alerts](docs/screenshots/business_alerts.png)

**Top Debtors**
![Top Debtors](docs/screenshots/top_debtors.png)

**Sales Summary**
![Sales Summary](docs/screenshots/sales_summary.png)

---

## Installation

### Requirements

- Python 3.11+
- An OpenAI API key (optional — the app runs fully offline on mock data without one)
- An Odoo instance with XML-RPC enabled (optional — only needed for live mode)

### Setup

```bash
git clone https://github.com/ZEYID-H/ODOO-AI-AGENT.git
cd ODOO-AI-AGENT

python -m venv venv
# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
```

### Environment Variables

Set in `.env` (never commit this file — it's already in `.gitignore`):

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | For AI routing | Enables OpenAI function calling. Without it, the app falls back to deterministic rule-based routing automatically. |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini`. |
| `DATA_BACKEND` | No | `mock` (default, offline) or `odoo` (live, read-only). |
| `ODOO_URL` | For live mode | Base URL of your Odoo instance. |
| `ODOO_DB` | For live mode | Odoo database name. |
| `ODOO_USERNAME` | For live mode | Must be the dedicated read-only user, e.g. `AI_AGENT_READONLY`. |
| `ODOO_PASSWORD` | For live mode | API key (preferred) or password for that user. |
| `EXPECTED_ODOO_USER` | For live mode | Safety check — startup refuses to run if `ODOO_USERNAME` doesn't match this. |

### Running Locally

**Mock mode (no Odoo, no OpenAI key required):**

```bash
streamlit run app.py
```

**With OpenAI function calling (mock data, smarter routing):**

```bash
# Ensure OPENAI_API_KEY is set in .env
streamlit run app.py
```

**Live Odoo mode:**

```bash
# Ensure ODOO_* vars are set in .env
DATA_BACKEND=odoo streamlit run app.py
```

The app opens at **http://localhost:8501**.

### Connecting to Odoo

1. Create a dedicated Odoo user (`AI_AGENT_READONLY`) with **read-only** access
   to the models listed in [`docs/ODOO_READONLY_USER.md`](docs/ODOO_READONLY_USER.md).
   This is the **primary** security control — do this before anything else.
2. Generate an API key for that user (Odoo → Account Security → New API Key).
3. Set `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME=AI_AGENT_READONLY`, `ODOO_PASSWORD`,
   `EXPECTED_ODOO_USER=AI_AGENT_READONLY`, and `DATA_BACKEND=odoo` in `.env`.
4. Verify the connection before opening the UI:
   ```bash
   python tests/test_odoo_connection.py
   ```
5. Run the security suite once more against your real setup:
   ```bash
   python tests/test_security.py
   ```

### Full SaaS Stack (Next.js + FastAPI, Docker Compose)

A second, additive front end — a Next.js chat UI with login and persistent,
per-user conversation history — talks to the same `route_query()` through a
thin FastAPI wrapper (`apps/api`). Both containers run alongside the
Streamlit app via Docker Compose:

```bash
docker compose -f docker-compose.saas.yml build
docker compose -f docker-compose.saas.yml up
```

Web at http://localhost:3000, API at http://localhost:8000. See
[`docs/DOCKER_SAAS_STACK.md`](docs/DOCKER_SAAS_STACK.md) for required env
files, the architecture, and troubleshooting.

---

## Project Structure

```
odoo-ai-agent/
├── app.py                          # Streamlit UI (presentation only)
├── requirements.txt
├── .env.example
├── README.md · SECURITY_REVIEW.md · DEMO.md · PRODUCTION_CHECKLIST.md
│
├── docs/
│   ├── ODOO_READONLY_USER.md       # Primary security control setup
│   ├── TOOLS.md                    # Full tool reference
│   ├── USER_GUIDE.md               # Example prompts by category
│   └── PHASE_1_REVIEW.md           # Historical: original MVP milestone
│
├── src/
│   ├── data/
│   │   ├── mock_data.py            # Offline demo dataset
│   │   └── provider.py             # mock/odoo backend switch + normalization
│   │
│   ├── services/
│   │   ├── odoo_security.py        # Read-only whitelist + audit log (secondary control)
│   │   ├── odoo_config.py          # Startup validation (tertiary control)
│   │   ├── odoo_service.py         # THE ONLY XML-RPC gateway
│   │   └── openai_service.py       # LLM function-calling adapter
│   │
│   ├── agent/
│   │   ├── router.py               # Orchestrator: OpenAI path + rule-based fallback
│   │   ├── tool_schemas.py         # OpenAI function-calling schemas
│   │   ├── tool_registry.py        # name -> {function, formatter}
│   │   └── prompts.py              # System prompt + static messages
│   │
│   ├── tools/                      # 14 read-only business-logic tools + formatters
│   │   ├── customer_tools.py · invoice_tools.py · sales_tools.py
│   │   ├── dashboard_tools.py · collections_tools.py
│   │   ├── customer_insights_tools.py · product_insights_tools.py
│   │   ├── business_alerts_tools.py · export_tools.py
│   │
│   └── utils/
│       ├── formatting.py           # Currency/date/table formatters
│       └── date_filters.py         # Natural-language date-range parser
│
├── tests/
│   ├── test_provider.py · test_security.py
│   ├── test_date_filters.py · test_odoo_connection.py
└── test_routing.py                 # End-to-end rule-based routing smoke test
```

---

## Known Limitations

- **Read-only by design** — the assistant cannot create, edit, or delete
  anything in Odoo. This is a deliberate security boundary, not a gap.
- **Depends on Odoo data quality** — categories, credit limits, and reference
  fields that aren't populated in Odoo won't appear in analytics (the tools
  degrade gracefully rather than erroring).
- **`credit_limit` may be unavailable** on some Odoo editions; the provider
  falls back to `0.0` when the field isn't exposed via XML-RPC.
- **Period statements have no opening balance** — a date-filtered customer
  statement's running balance starts at zero for that window, not the true
  historical balance; this is stated explicitly in the output.
- **Rule-based fallback has a smaller vocabulary** than the LLM path — a few
  ambiguous phrasings (e.g. "tell me about a product" vs "tell me about a
  customer") only resolve correctly via OpenAI function calling, not the
  offline fallback.
- **No multi-tenant / multi-currency handling** — currency is displayed as
  QAR; adapting to another base currency requires a small formatter change.

## Future Improvements

- Configurable analytics thresholds (currently constants in each tool module).
- Push-based alerting (scheduled `get_business_alerts` runs + notification).
- Multi-currency-aware formatting driven by the Odoo company record.
- Broader natural-language date coverage (fiscal-year-aware periods).
- Automated screenshot generation for documentation.

---

## License

MIT License — see [`LICENSE`](LICENSE).

## Author

**ZEED AL-HAJ ALI**
Repository: [github.com/ZEYID-H/ODOO-AI-AGENT](https://github.com/ZEYID-H/ODOO-AI-AGENT)
