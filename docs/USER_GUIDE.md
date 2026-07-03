# User Guide — How to Ask Questions

The assistant understands plain-English business questions. Type them into
the chat, or click a Quick Questions button in the sidebar to ask directly.
This guide groups example prompts by capability; any close rephrasing of
these should also work via OpenAI function calling.

---

## Customer Insights

Deep analytics for a single customer — lifetime revenue, order value,
purchase recency, and a risk level.

- "Customer insights for Apple Mart"
- "Customer analytics for Apple Mart"
- "Analyze customer Apple Mart"
- "Tell me about Apple Mart"

## Product Insights

Deep analytics for a product or product family. If your query matches
several SKUs (e.g. a category name), the assistant combines them and lists
which SKUs were included.

- "Product insights for Olive Oil"
- "How is Olive Oil selling?"
- "Product performance for Pickles"
- "Analyze product Grape Leaves"

## Business Alerts

A ranked list of risks and opportunities — overdue customers, large unpaid
invoices, customers who've gone quiet, product concentration risk.

- "Show business alerts"
- "What should I worry about?"
- "Show urgent business risks"
- "Business health alerts"

## Sales Summary

Revenue, transaction count, and top customers/products for a period.

- "Show sales summary"
- "Sales this month"
- "Sales last quarter"
- "Sales between 2026-01-01 and 2026-03-31"

## Dashboard

One-screen executive rollup of the key numbers.

- "Show dashboard"
- "Executive summary"
- "Business overview"
- "KPIs"

## Top Debtors

Customers ranked by how much they currently owe.

- "Who owes us the most money?"
- "Top debtors"
- "Customers with the highest outstanding balance"
- "Biggest customer balances"

## Top Products

Best sellers by revenue, with an optional time period.

- "Top selling products"
- "Top selling products this month"
- "Best sellers last month"

## Invoices

Unpaid and overdue invoices, with an optional customer or date filter.

- "Show unpaid invoices"
- "Unpaid invoices for Apple Mart"
- "Show overdue invoices"
- "Overdue invoices this month"

## Customer Statement & Export

A full chronological statement of account for a customer, with CSV/Excel
download buttons attached to the response.

- "Customer statement for Apple Mart"
- "Account statement for Apple Mart this year"
- "Show transactions for Take Away Opera Restaurant"

## Collections

A prioritized worklist for who to call first, with a recommended action per
customer.

- "Who should we follow up with?"
- "Collection priorities"
- "Payment follow up"

---

## Tips

- **Follow-ups work**: after asking about a customer, "show unpaid invoices
  too" resolves "too" back to that same customer using lightweight
  conversation memory — but the actual figures are always re-fetched fresh,
  never recalled from memory.
- **Date phrases**: `today`, `yesterday`, `this week`, `last week`, `this
  month`, `last month`, `this quarter`, `last quarter`, `this year`, `last
  year`, or an explicit range (`between 2026-01-01 and 2026-03-31`).
- **If OpenAI is unavailable**, the assistant automatically falls back to
  deterministic keyword routing — the same tools and answers, just a smaller
  vocabulary of recognized phrasings.
