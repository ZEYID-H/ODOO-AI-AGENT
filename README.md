# Odoo AI Agent
### AI-Powered ERP Assistant for Business Intelligence and Workflow Automation

---

## Project Overview

An AI assistant that allows business users to interact with Odoo ERP using natural language.
Ask questions like:

- *"How much does APPLE MART owe us?"*
- *"Show unpaid invoices for GOLDEN STAR TRADING"*
- *"Which customers have overdue invoices?"*
- *"Top selling products this month"*
- *"Summarize sales for June 2026"*

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Streamlit |
| Backend | Python 3.11+ |
| AI (Phase 2+) | OpenAI API, Function Calling |
| ERP (Phase 3+) | Odoo XML-RPC |
| Data | Mock Data → PostgreSQL |

---

## Current Phase: Phase 1 – MVP (Mock Data)

**What works:**
- Streamlit chat interface
- Rule-based intent detection and routing
- 7 tool functions querying realistic mock data
- Structured markdown responses with tables

**Mock Data includes:**
- 5 customers
- 12 invoices (paid / unpaid / overdue)
- 8 payment records
- 10 products
- 32 sales records across April, May, June 2026

---

## Setup & Run

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/odoo-ai-agent.git
cd odoo-ai-agent
```

### 2. Create a virtual environment
```bash
python -m venv venv
```

### 3. Activate the virtual environment
**Windows:**
```bash
venv\Scripts\activate
```
**macOS / Linux:**
```bash
source venv/bin/activate
```

### 4. Install dependencies
```bash
pip install -r requirements.txt
```

### 5. Run the application
```bash
streamlit run app.py
```

The app will open at **http://localhost:8501**

---

## Project Structure

```
odoo-ai-agent/
├── app.py                    # Streamlit entry point
├── requirements.txt
├── README.md
│
└── src/
    ├── data/
    │   └── mock_data.py      # Customers, invoices, payments, products, sales
    │
    ├── tools/
    │   ├── customer_tools.py  # Balance, summary, payment history
    │   ├── invoice_tools.py   # Unpaid invoices, overdue invoices
    │   └── sales_tools.py     # Top products, sales summary
    │
    ├── agent/
    │   ├── router.py          # Rule-based intent router
    │   └── prompts.py         # System prompts (used in Phase 2)
    │
    └── utils/
        └── formatting.py      # Markdown table formatters
```

---

## Available Tool Functions

| Function | Description |
|----------|-------------|
| `get_customer_balance()` | Outstanding balance for a customer |
| `get_unpaid_invoices()` | Unpaid invoices (all or per customer) |
| `get_overdue_invoices()` | All overdue invoices across customers |
| `get_customer_summary()` | Full account overview |
| `get_payment_history()` | Payment records for a customer |
| `get_top_selling_products()` | Top products ranked by revenue |
| `get_sales_summary()` | Sales performance for a given period |

---

## Roadmap

- [x] Phase 1 – MVP with Mock Data
- [ ] Phase 2 – LLM Agent Layer (OpenAI Function Calling)
- [ ] Phase 3 – Real Odoo Integration (XML-RPC)
- [ ] Phase 4 – Business Intelligence Features
- [ ] Phase 5 – Agent Workflows
- [ ] Phase 6 – Dashboard with Charts
- [ ] Phase 7 – Production Hardening
- [ ] Phase 8 – Portfolio Version

---

## Resume Bullet

> Built an AI-powered ERP Assistant integrating Odoo ERP, LLM function calling, workflow automation, business intelligence reporting, and natural language analytics using Python, Streamlit, OpenAI APIs, and Odoo integrations.
