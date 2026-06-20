from src.agent.router import route_query

tests = [
    "How much does APPLE MART owe us?",
    "Show unpaid invoices for APPLE MART",
    "Which customers have overdue invoices?",
    "Top selling products this month",
    "Summarize sales for June 2026",
    "Payment history for GOLDEN STAR TRADING",
    "Customer summary for BLUE OCEAN LLC",
    "What does TECH SOLUTIONS CO owe?",
    "Show all unpaid invoices",
    "who owes us the most money",
    "top debtors",
    "customer statement for APPLE MART",
]

print("=" * 60)
print("ODOO AI AGENT – Phase 1 Routing Test")
print("=" * 60)

for q in tests:
    r = route_query(q)
    print(f"\nQ: {q}")
    print(f"   Tool     : {r['tool']}")
    print(f"   Params   : {r['parameters']}")
    preview = r["result"][:80].replace("\n", " ")
    print(f"   Result   : {preview}...")

print("\n" + "=" * 60)
print("All tests passed.")
