"""OpenAI function-calling schemas for the ERP tools.

These are pure JSON descriptions handed to the OpenAI API via `tools=[...]`.
They contain NO executable logic — they only tell the model which functions
exist, when to use each, and what arguments each accepts.

Each schema's `name` must match a key in `tool_registry.TOOL_REGISTRY`, and its
arguments mirror the real signatures in `src/tools/`. Optional Python arguments
(those with defaults) are left out of `required` so the model can omit them.

Relative periods ("this month", "last month") are NOT encoded here; the system
prompt supplies the current date and the model converts them to month/year.
Customer names are intentionally not enumerated so Phase 3 (live Odoo customers)
needs no schema change.
"""

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "get_customer_balance",
            "description": (
                "Get the outstanding balance a single customer owes: total due, "
                "overdue amount, open invoice count and credit utilization. Use for "
                "questions like 'How much does X owe?', 'What is X's balance?', "
                "'How much is outstanding from X?'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_name": {
                        "type": "string",
                        "description": (
                            "The customer/company name, e.g. 'APPLE MART'. "
                            "Matched case-insensitively."
                        ),
                    }
                },
                "required": ["customer_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_customer_summary",
            "description": (
                "Get a full account overview for one customer: contact details, "
                "total billed, total paid, outstanding and overdue amounts, plus "
                "full invoice and payment history. Use for 'customer summary', "
                "'account overview' or 'profile for X' requests."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_name": {
                        "type": "string",
                        "description": "The customer/company name. Matched case-insensitively.",
                    }
                },
                "required": ["customer_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_payment_history",
            "description": (
                "Get the list of payments made by one customer, newest first, with "
                "the total paid. Use for 'payment history', 'payments made by X', "
                "'show payments for X'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_name": {
                        "type": "string",
                        "description": "The customer/company name. Matched case-insensitively.",
                    }
                },
                "required": ["customer_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_collection_priorities",
            "description": (
                "Rank customers who need payment follow-up by a collection priority "
                "score (overdue amount, days overdue, overdue invoice count). This is "
                "the CUSTOMER-LEVEL collections view — prefer it for ANY question about "
                "overdue CUSTOMERS or accounts to chase. Use for 'overdue customers', "
                "'customers overdue', 'customers with overdue balances', 'overdue "
                "customer follow-up', 'who should we follow up with', 'collection "
                "priorities', 'payment follow up', 'customers requiring follow-up', "
                "'who should we call'. (For a plain list of overdue invoices, use "
                "get_overdue_invoices instead.) Returns outstanding balance, overdue "
                "amount, invoice count, oldest due date, days overdue, priority level "
                "(Critical/High/Medium/Low) and a recommended action."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Optional: return only the top N priorities.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_dashboard_summary",
            "description": (
                "Executive management dashboard: total revenue, outstanding "
                "receivables, total overdue, open and overdue invoice counts, "
                "average transaction value, top debtor, top product, and customer "
                "and product counts. Use for 'dashboard', 'executive summary', "
                "'executive dashboard', 'management summary', 'business overview', "
                "'KPIs', 'key metrics'."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_customer_statement",
            "description": (
                "Produce a customer's statement of account: a chronological ledger "
                "of invoices (debits) and payments (credits) with a running balance, "
                "plus totals and outstanding balance. Use for 'customer statement', "
                "'account statement', 'statement of account', 'customer ledger', "
                "'ledger for customer X', 'show transactions for customer X'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_name": {
                        "type": "string",
                        "description": "The customer/company name. Matched case-insensitively.",
                    }
                },
                "required": ["customer_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_debtors",
            "description": (
                "Rank customers by total outstanding balance (unpaid + overdue), "
                "highest first. Use for 'who owes us the most money', 'top debtors', "
                "'biggest customer balances', 'customers with the highest outstanding "
                "balance', 'who has the largest unpaid balance', 'rank customers by "
                "amount owed'. Returns each customer's outstanding balance, overdue "
                "amount, open invoice count and oldest due date."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "How many top customers to return. Defaults to 10.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_unpaid_invoices",
            "description": (
                "List unpaid and overdue invoices. If a customer name is given, "
                "results are filtered to that customer; otherwise all customers are "
                "returned. Use for 'unpaid invoices', 'outstanding invoices', "
                "'open invoices for X'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_name": {
                        "type": "string",
                        "description": (
                            "Optional customer/company name to filter by. Omit to "
                            "list unpaid invoices across all customers."
                        ),
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_overdue_invoices",
            "description": (
                "List all invoices that are past their due date, grouped by customer "
                "and ranked by amount overdue. Takes no arguments. Use for 'overdue "
                "invoices', 'which customers are past due', 'late payments'."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_selling_products",
            "description": (
                "Get the top products ranked by revenue for an optional period. Use "
                "for 'top selling products', 'best sellers', 'most sold products'. "
                "Provide month and/or year to scope the period; omit them for all time."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {
                        "type": "integer",
                        "description": (
                            "Month number 1-12. Resolve relative terms like "
                            "'this month' using the current date from context."
                        ),
                    },
                    "year": {
                        "type": "integer",
                        "description": "Four-digit year, e.g. 2026.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_sales_summary",
            "description": (
                "Get a sales performance summary for an optional period: total "
                "revenue, transaction count, average transaction value, and top "
                "customers and products by revenue. Use for 'sales summary', "
                "'summarize sales for June 2026', 'sales performance', 'revenue report'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {
                        "type": "integer",
                        "description": (
                            "Month number 1-12. Resolve relative terms like "
                            "'this month' using the current date from context."
                        ),
                    },
                    "year": {
                        "type": "integer",
                        "description": "Four-digit year, e.g. 2026.",
                    },
                },
                "required": [],
            },
        },
    },
]


def tool_names() -> set[str]:
    """Return the set of schema function names, used to validate the registry."""
    return {schema["function"]["name"] for schema in TOOL_SCHEMAS}
