# Tool Reference

Complete reference for all 14 tools registered in `src/agent/tool_registry.py`.
This count is verified to match `TOOL_REGISTRY` by an automated check
(`registry == schema` parity) that runs at import time and in
`tests/test_security.py` / ad-hoc verification scripts throughout the project.

Every tool is **read-only**: it calls `src/data/provider.py`, which in Odoo
mode reads through the single gateway (`src/services/odoo_service.py`), gated
by `enforce_read_only()`. No tool can write to Odoo.

---

### 1. `get_customer_balance(customer_name)`

**Purpose:** Outstanding balance for a single customer.
**Typical questions:** "How much does Apple Mart owe us?", "What's Apple Mart's balance?"
**Returns:** `customer_name`, `total_balance`, `overdue_amount`, `unpaid_count`, `oldest_due_date`, `credit_limit`, `credit_used_pct`, `open_invoices` (list).

### 2. `get_customer_summary(customer_name)`

**Purpose:** Full account overview — contact details plus financial totals.
**Typical questions:** "Customer summary for Apple Mart", "Account overview for X".
**Returns:** `customer` (contact info), `total_invoices`, `total_billed`, `total_paid`, `outstanding_balance`, `overdue_amount`, `payments` (list), `invoices` (list).

### 3. `get_payment_history(customer_name)`

**Purpose:** Payments made by a customer, most recent first.
**Typical questions:** "Payment history for Apple Mart", "Show payments made by X".
**Returns:** `customer_name`, `payments` (list), `total_payments`, `total_paid`.

### 4. `get_customer_statement(customer_name, period=None)`

**Purpose:** Chronological statement of account — invoices (debits) and
payments (credits) merged into one dated ledger with a running balance.
**Typical questions:** "Customer statement for Apple Mart", "Account statement
for X this year", "Show transactions for X".
**Returns:** `customer_name`, `rows` (date/type/reference/debit/credit/balance),
`total_invoiced`, `total_paid`, `outstanding_balance` (authoritative, from
`get_customer_balance`), `activity_balance`, `invoice_count`, `payment_count`,
`reconciles` (bool), `difference`, `period_label`, `period_note`.
**Note:** the chat display caps the rendered table at the latest 50
transactions; totals are always computed from the full dataset. Statement
exports (CSV/Excel) include every row.

### 5. `get_top_debtors(limit=10, period=None)`

**Purpose:** Rank customers by total outstanding balance, highest first.
**Typical questions:** "Who owes us the most money?", "Top debtors", "Biggest
customer balances".
**Returns:** `debtors` (ranked list: customer_name, outstanding_balance,
overdue_amount, open_invoice_count, oldest_due_date), `customer_count`,
`total_outstanding`, `limit`.

### 6. `get_customer_insights(customer_name)`

**Purpose:** Deep customer-level business intelligence — the analytics view,
distinct from a plain balance or summary.
**Typical questions:** "Customer insights for Apple Mart", "Analyze customer
X", "Tell me about Apple Mart".
**Returns:** `lifetime_revenue` (sales-based), `total_invoices`,
`total_payments`, `outstanding_balance`, `overdue_amount`,
`average_order_value`, `first_purchase_date`, `last_purchase_date`,
`days_since_last_purchase`, `purchase_frequency`, `risk_level`
(Low/Medium/High), `recommended_action`.

### 7. `get_collection_priorities(limit=None)`

**Purpose:** Rank customers needing payment follow-up by a transparent
priority score.
**Typical questions:** "Who should we follow up with?", "Collection
priorities", "Overdue customers", "Payment follow up".
**Formula:** `score = overdue_amount * (1 + days_overdue/30) + overdue_invoice_count * 100`.
**Levels:** Critical (≥30d overdue or ≥QAR 20,000), High (≥14d or ≥QAR 5,000),
Medium (≥1d or any overdue), Low (otherwise).
**Returns:** `priorities` (ranked list with `priority` + `recommended_action`),
`customer_count`, `total_overdue`.

### 8. `get_unpaid_invoices(customer_name=None, period=None)`

**Purpose:** List unpaid + overdue invoices, optionally filtered by customer
and/or a natural-language date range (filters on `issue_date`).
**Typical questions:** "Show unpaid invoices", "Unpaid invoices for Apple Mart
this month".
**Returns:** `customer_name` (filter used, if any), `invoices` (list),
`count`, `total_amount`.

### 9. `get_overdue_invoices(period=None)`

**Purpose:** All invoices past due, grouped and ranked by customer.
**Typical questions:** "Show overdue invoices", "Which customers are past
due?".
**Returns:** `invoices` (list), `count`, `total_amount`, `customers_affected`,
`by_customer` (per-customer rollup with invoice_count, total_overdue,
oldest_due).

### 10. `get_top_selling_products(period=None, month=None, year=None, limit=5)`

**Purpose:** Top products ranked by revenue for an optional period.
**Typical questions:** "Top selling products this month", "Best sellers last
quarter".
**Returns:** `products` (ranked list: product_name, category, total_revenue,
total_qty, order_count), `period_label`, `total_revenue`, `total_transactions`.

### 11. `get_product_insights(product_name)`

**Purpose:** Deep product-level analytics with locked matching rules:
1. Exact match on the sold product's display name.
2. Else aggregate every SKU whose name **contains** the query (e.g. "OLIVE
   OIL" combines every olive-oil SKU) — the matched SKUs are always listed.
3. Else a clear "no product found" result.

**Typical questions:** "Product insights for Olive Oil", "How is Olive Oil
selling?", "Analyze product X".
**Returns:** `query`, `mode` (`exact`/`aggregated`/`no_match`),
`matched_skus` (list), `revenue`, `units_sold`, `customer_count`,
`first_sale_date`, `last_sale_date`, `average_sale_price`,
`revenue_share_pct` (denominator = `get_sales_summary()["total_revenue"]`),
`top_customers` (list).

### 12. `get_sales_summary(period=None, month=None, year=None)`

**Purpose:** Sales performance for an optional period.
**Typical questions:** "Sales summary", "Sales this month", "Sales between
2026-01-01 and 2026-03-31".
**Returns:** `period_label`, `total_revenue`, `total_transactions`,
`avg_transaction`, `by_customer` (top revenue customers), `by_product`
(top revenue products, top 5).

### 13. `get_dashboard_summary()`

**Purpose:** Executive KPI rollup, composed entirely from the tools above —
no calculations are duplicated. Totals therefore match their source tools
exactly by construction.
**Typical questions:** "Show dashboard", "Executive summary", "Business
overview", "KPIs".
**Returns:** `total_revenue`, `avg_transaction`, `total_transactions`,
`outstanding_receivables`, `total_overdue`, `overdue_invoice_count`,
`open_invoice_count`, `top_debtor`, `top_product`, `customer_count`,
`product_count`.

### 14. `get_business_alerts(limit=10)`

**Purpose:** Proactive risk/opportunity dashboard across five categories:
overdue customers (reuses `get_collection_priorities`), large unpaid invoices,
inactive customers (lifetime revenue + recency, computed in one pass over
sales data), product concentration risk (reuses `get_top_selling_products` +
`get_sales_summary`), and opportunity (recently active top-revenue customer).
**Typical questions:** "Show business alerts", "What should I worry about?",
"Show urgent business risks", "Business health alerts".
**Returns:** `alerts` (ranked list: risk_level, alert_type, title, details,
recommended_action), `total_alerts`.

---

## Not a tool: `export_customer_statement`

`src/tools/export_tools.py::export_customer_statement(customer_name, format)`
generates a CSV or Excel download from `get_customer_statement`'s data. It is
**not** registered as an OpenAI tool — it's invoked directly by the Streamlit
UI's download buttons, not by natural-language routing.
