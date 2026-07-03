# Demo Script — 5 Minutes

A suggested walkthrough for demonstrating the Odoo Business Intelligence
Assistant to a business or technical audience. Run `streamlit run app.py`
(add `DATA_BACKEND=odoo` beforehand for a live-data demo) before starting.

---

### 1. Open the Application (30s)

Launch the app and let the landing screen speak for itself: the title, the
"Read-only AI assistant for business analytics and reporting" subtitle, and
the four status badges (Read Only, Secure, Odoo Connected, GPT Powered).
Point out the sidebar: live tool count, current backend, and one-click Quick
Questions — no typing required to get started.

> *"This is a natural-language interface in front of live Odoo data. Every
> answer you're about to see is read directly from the ERP — nothing is
> hardcoded, and nothing it does can change a record."*

### 2. Show the Dashboard (45s)

Expand **Executive Dashboard** in the main panel and click **Load / Refresh
Dashboard**.

> *"One screen, the numbers a manager actually wants: revenue, receivables,
> total overdue, open and overdue invoice counts, top debtor, top product.
> Every one of these numbers is composed from the same tools you'll see
> answering chat questions — nothing here is calculated twice."*

Point at the two charts: top 5 debtors, top 5 products by revenue.

### 3. Customer Insights (45s)

Click the **Customer Insights — Apple Mart** quick-question button (or type
*"Customer insights for Apple Mart"*).

> *"This isn't just a balance — it's lifetime revenue, average order value,
> when they last bought from us, and a computed risk level with a
> recommended action. This is the kind of analysis that used to mean
> exporting to Excel."*

### 4. Product Insights (45s)

Click **Product Insights — Olive Oil** (or type *"How is Olive Oil
selling?"*).

> *"Notice it didn't just match one SKU — Olive Oil comes in a dozen
> package sizes in this catalog, and the assistant combined all of them and
> tells you exactly which ones it combined. Revenue share is measured
> against total company revenue, not just this category."*

### 5. Business Alerts (45s)

Click **Business Alerts** (or type *"What should I worry about?"*).

> *"This is the proactive side — the assistant doesn't wait to be asked
> about a specific customer. It surfaces overdue accounts by severity,
> unusually large unpaid invoices, customers who've gone quiet, and product
> concentration risk — each with a plain-English explanation and a
> recommended action."*

### 6. Top Debtors (30s)

Click **Top Debtors** (or type *"Who owes us the most money?"*).

> *"A straight ranking, with outstanding balance, overdue amount, and the
> oldest unpaid invoice date — this is the same underlying data the
> Business Alerts and Dashboard both draw from."*

### 7. Sales Summary (30s)

Click **Sales Summary**, then try *"sales last month"* to show natural-
language date filtering.

> *"You can scope almost any question to a time period just by saying it —
> this month, last quarter, or an explicit date range."*

### 8. Security Explanation (45s)

Open `SECURITY_REVIEW.md` or simply narrate:

> *"Four independent layers make sure this stays read-only: a dedicated
> Odoo user with no write permissions at all, a code-level whitelist that
> only allows search/search_read/read and rejects everything else with an
> exception, a startup check that refuses to run in an unsafe configuration,
> and a full audit log of every request. Even if the AI model made a
> mistake or was tricked by a malicious prompt, there's no path from here to
> a write in Odoo — that's enforced independently of the AI."*

### 9. Closing (15s)

> *"Everything you saw came from natural language, read live from Odoo, with
> zero risk to the underlying data. The same assistant can export any
> customer statement to CSV or Excel on demand — this is a tool for
> managers and analysts, not just developers."*

---

**Total runtime: ~5 minutes.** Adjust customer/product names in the quick
questions to match your own Odoo data if presenting live.
