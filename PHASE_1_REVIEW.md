# Phase 1 Review — MVP with Mock Data

**Project:** Odoo AI Agent — AI-Powered ERP Assistant
**Phase:** 1 of 8 (MVP, Mock Data, Rule-Based Routing)
**Status:** Complete and verified running
**Date:** 2026-06-20

---

## 1. What Was Built

A fully runnable, local AI business assistant with **zero external dependencies on AI APIs or a database**. It accepts natural-language business questions through a Streamlit chat interface, detects the user's intent using a rule-based router, calls the matching tool function against realistic mock ERP data, and returns structured Markdown tables.

**Highlights:**
- Streamlit chat UI with sidebar (customer list, example queries, clear-chat).
- Rule-based intent router covering 7 distinct business intents.
- 7 tool functions querying 5 mock datasets.
- Clean separation: **data → tools → formatters → router → UI**.
- Verified working: all 7 example queries route to the correct tool and return correct numbers.

**Architectural principle:** Tool functions return raw `dict` data; formatting is a separate layer. This is deliberate so Phase 2 (LLM function calling) can reuse the exact same tools and formatters without modification — only the router gets swapped.

---

## 2. Project Structure

```
odoo-ai-agent/
├── app.py                      # Streamlit entry point (chat UI)
├── requirements.txt            # Dependencies (streamlit only)
├── README.md                   # Setup & usage docs
├── PHASE_1_REVIEW.md           # This file
├── test_routing.py             # Manual routing validation script
│
└── src/
    ├── __init__.py
    ├── data/
    │   ├── __init__.py
    │   └── mock_data.py        # Customers, invoices, payments, products, sales
    │
    ├── tools/
    │   ├── __init__.py
    │   ├── customer_tools.py   # Balance, summary, payment history
    │   ├── invoice_tools.py    # Unpaid invoices, overdue invoices
    │   └── sales_tools.py      # Top products, sales summary
    │
    ├── agent/
    │   ├── __init__.py
    │   ├── router.py           # Rule-based intent detection & dispatch
    │   └── prompts.py          # System prompt + help messages (used in Phase 2)
    │
    └── utils/
        ├── __init__.py
        └── formatting.py       # Currency/date helpers + Markdown table builders
```

---

## 3. Explanation of Every File

### Root

| File | Purpose |
|------|---------|
| `app.py` | Streamlit entry point. Renders the sidebar, chat history, and chat input. On each user message it calls `route_query()` and displays the tool name, parameters, and Markdown result. Maintains chat history in `st.session_state`. |
| `requirements.txt` | Declares dependencies. Phase 1 only needs `streamlit` (no `openai`, no DB driver — those come in later phases per the development rules). |
| `README.md` | Project overview, tech stack, setup/run commands, tool reference, and roadmap. |
| `test_routing.py` | Standalone script that runs 9 sample queries through the router and prints the chosen tool, parameters, and a result preview. Used to verify routing without launching the UI. |

### `src/data/`

| File | Purpose |
|------|---------|
| `mock_data.py` | Single source of truth for all mock ERP data. Defines `TODAY = date(2026, 6, 20)` as the reference "now", plus five datasets: **CUSTOMERS** (5), **INVOICES** (12: paid/unpaid/overdue), **PAYMENTS** (8), **PRODUCTS** (10), **SALES** (32 rows across April–June 2026). Data is internally consistent (paid invoices have matching payment records, overdue dates precede TODAY). |

### `src/tools/`

| File | Functions | Purpose |
|------|-----------|---------|
| `customer_tools.py` | `get_customer_balance`, `get_customer_summary`, `get_payment_history` + their `format_*` functions, plus private `_find_customer` | Customer-centric queries: outstanding balance with credit utilization, full account overview, and payment records. |
| `invoice_tools.py` | `get_unpaid_invoices`, `get_overdue_invoices` + their `format_*` functions | Invoice queries. Unpaid supports an optional customer filter; overdue aggregates across all customers and groups by customer. |
| `sales_tools.py` | `get_top_selling_products`, `get_sales_summary` + their `format_*` functions, plus private helpers `_filter_sales`, `_get_product_category`, `_period_label` | Sales analytics: revenue-ranked product leaderboard and a period sales summary (top customers + top products). |

**Pattern in every tool file:** a `get_*` function returns a raw `dict`; a paired `format_*` function turns that dict into Markdown. This keeps business logic testable and independent of presentation.

### `src/agent/`

| File | Purpose |
|------|---------|
| `router.py` | The "brain" of Phase 1. `route_query(query)` runs three extractors — `_detect_intent` (keyword matching, ordered most-specific-first), `_extract_customer` (matches against known customer names), `_extract_period` (parses month names, years, "this/last month") — then dispatches to the correct tool, formats the result, and returns `{"tool", "parameters", "result"}`. |
| `prompts.py` | Holds `SYSTEM_PROMPT` (for Phase 2's LLM), plus `UNKNOWN_INTENT_MSG` and `NO_CUSTOMER_MSG` fallback messages used by the router today. |

### `src/utils/`

| File | Purpose |
|------|---------|
| `formatting.py` | Presentation helpers: `fmt_currency`, `fmt_date`, `days_overdue` (relative to TODAY), and Markdown table builders (`fmt_invoice_table`, `fmt_payment_table`, `fmt_product_table`, `fmt_status_badge`). Centralizing formatting keeps the tool files clean. |

---

## 4. Available Tools / Functions

| Function | Parameters | Returns | Triggered By (examples) |
|----------|-----------|---------|--------------------------|
| `get_customer_balance` | `customer_name` | Outstanding balance, overdue amount, credit utilization, open invoices | "how much does X owe", "X balance", "amount due" |
| `get_unpaid_invoices` | `customer_name` (optional) | List of unpaid + overdue invoices, total outstanding | "unpaid invoices", "open invoices", "show invoices" |
| `get_overdue_invoices` | — | All overdue invoices grouped by customer | "overdue", "past due", "late invoices" |
| `get_customer_summary` | `customer_name` | Full account overview: billed, paid, balance, invoice + payment history | "customer summary", "account overview" |
| `get_payment_history` | `customer_name` | Payment records sorted newest-first, total paid | "payment history", "payments made" |
| `get_top_selling_products` | `month`, `year` | Revenue-ranked product leaderboard | "top selling products", "best products" |
| `get_sales_summary` | `month`, `year` | Revenue, transaction count, avg value, top customers/products | "sales summary", "summarize sales", "sales performance" |

---

## 5. Example Queries and Expected Outputs

### Query: "How much does APPLE MART owe us?"
**Routes to:** `get_customer_balance(customer_name="APPLE MART")`

```
## Account Balance: APPLE MART

| Field                  | Value      |
|------------------------|------------|
| Outstanding Balance    | $21,250.00 |
| Overdue Amount         | $12,500.00 |
| Open Invoices          | 2          |
| Oldest Due Date        | 31 May 2026|
| Credit Limit           | $50,000.00 |
| Credit Utilization     | 42.5%      |

> Warning: This customer has $12,500.00 in overdue payments.

### Open Invoices
| INV-2026-001 | Grocery Supply – May 2026  | $12,500.00 | OVERDUE (20d) | 31 May 2026 |
| INV-2026-002 | Grocery Supply – June 2026 | $8,750.00  | UNPAID        | 30 Jun 2026 |
```

### Query: "Top selling products this month"
**Routes to:** `get_top_selling_products(month=6, year=2026)`

```
## Top Selling Products – June 2026
Total Revenue: $56,480.00 | Transactions: 12

| Rank | Product                | Category               | Revenue    | Units Sold |
|------|------------------------|------------------------|------------|------------|
| 1    | Atlantic Salmon        | Seafood                | $13,500.00 | 750        |
| 2    | Chicken Breast         | Meat & Poultry         | $12,750.00 | 1,500      |
| 3    | Basmati Rice           | Grains                 | $7,200.00  | 6,000      |
| 4    | Extra Virgin Olive Oil | Condiments             | $6,000.00  | 500        |
| 5    | Dark Chocolate         | Snacks & Confectionery | $4,200.00  | 700        |
```

### Query: "Which customers have overdue invoices?"
**Routes to:** `get_overdue_invoices()` → 4 overdue invoices across 4 customers, total $43,200.00, grouped by customer with days overdue.

### Other verified queries
| Query | Tool | Parameters |
|-------|------|-----------|
| "Show unpaid invoices for APPLE MART" | `get_unpaid_invoices` | `customer_name=APPLE MART` |
| "Summarize sales for June 2026" | `get_sales_summary` | `month=6, year=2026` |
| "Payment history for GOLDEN STAR TRADING" | `get_payment_history` | `customer_name=GOLDEN STAR TRADING` |
| "Customer summary for BLUE OCEAN LLC" | `get_customer_summary` | `customer_name=BLUE OCEAN LLC` |
| "Show all unpaid invoices" | `get_unpaid_invoices` | `customer_name=None` |

---

## 6. Known Limitations

These are **expected and acceptable** for an MVP. Most are resolved by later phases.

1. **Keyword-based intent detection is brittle.** Phrasings outside the keyword sets fall through to the "unknown" fallback. (e.g. "What's the situation with Apple Mart?" won't route.) — *Fixed in Phase 2 by LLM reasoning.*
2. **Exact customer-name matching only.** The query must contain the customer name exactly as stored (case-insensitive). Typos, abbreviations ("Apple"), or fuzzy names won't match. — *Improved in Phase 2/3.*
3. **One intent per query.** Compound questions ("balance and payment history for X") only trigger the first matched intent.
4. **Static mock data.** All data is hard-coded in `mock_data.py`; nothing persists or updates. — *Replaced by live Odoo in Phase 3.*
5. **"Now" is hard-coded** to `2026-06-20`. Overdue calculations and "this month" are relative to that fixed date, not the real system clock. (Intentional, so the demo is deterministic.)
6. **No LLM, no natural-language generation.** Responses are template-formatted tables, not conversational prose. — *Added in Phase 2.*
7. **No error/observability layer.** No logging, auth, rate limiting, or caching. — *Added in Phase 7.*
8. **Order sensitivity in routing.** Intent checks are manually ordered by specificity; adding new intents requires care to avoid shadowing.

---

## 7. What Will Change in Phase 2

Phase 2 replaces **rule-based routing with LLM reasoning** via OpenAI Function Calling. The goal: the LLM decides which tool to call instead of keyword matching.

| Area | Phase 1 (now) | Phase 2 (next) |
|------|---------------|----------------|
| Intent detection | Keyword matching in `_detect_intent` | LLM interprets intent from natural language |
| Parameter extraction | Regex/string matching (`_extract_customer`, `_extract_period`) | LLM extracts arguments into the function schema |
| `router.py` | Rule dispatch | Calls OpenAI with tool definitions, executes the chosen tool, returns result |
| `prompts.py` | Mostly idle | `SYSTEM_PROMPT` actively drives the model |
| New file | — | Tool/function JSON schemas (OpenAI tool definitions) |
| New dependency | — | `openai` in `requirements.txt` |
| Config | — | `.env` with `OPENAI_API_KEY` |

**What stays unchanged (by design):**
- All `get_*` tool functions in `src/tools/` — same signatures, same return dicts.
- All `format_*` functions and `src/utils/formatting.py`.
- `src/data/mock_data.py`.
- The Streamlit UI in `app.py` (it already displays tool name + parameters generically).

This is the payoff of the data/tools/formatter separation: Phase 2 is largely additive.

---

## 8. Confirmation Checklist — Phase 1 Complete

- [x] Project folder structure created as specified.
- [x] All required files present (15 files).
- [x] Mock datasets created: customers, invoices, payments, products, sales.
- [x] Mock data is internally consistent (payments match paid invoices; overdue dates precede TODAY).
- [x] 7 tool functions implemented and working.
- [x] Each tool has a separate formatter (raw data vs. presentation).
- [x] Rule-based router implemented (intent + customer + period extraction).
- [x] Streamlit chat UI implemented with sidebar and examples.
- [x] UI displays which tool was called and with what parameters.
- [x] All 7 documented example queries route to the correct tool.
- [x] Edge cases handled: no customer found, unknown intent, "all customers" filter.
- [x] Dependencies install cleanly in a virtual environment.
- [x] Application runs locally (`streamlit run app.py` → http://localhost:8501).
- [x] No database used (correct for Phase 1).
- [x] No authentication used (correct for Phase 1).
- [x] No LLM/API calls used (correct for Phase 1).
- [x] README with exact run commands provided.

**Verdict: Phase 1 is complete, verified, and ready. Cleared to begin Phase 2.**
