export interface QuickAction {
  icon: string;
  title: string;
  description: string;
  question: string;
}

/** Mirrors the Streamlit prototype's quick-question set for consistency. */
export const QUICK_ACTIONS: QuickAction[] = [
  {
    icon: "🚨",
    title: "Business Alerts",
    description: "Critical risk and anomaly signals that need attention now.",
    question: "Show business alerts",
  },
  {
    icon: "👤",
    title: "Customer Insights — Apple Mart",
    description: "Full financial and behavioral profile for a single account.",
    question: "Customer insights for Apple Mart",
  },
  {
    icon: "📦",
    title: "Product Insights — Olive Oil",
    description: "Performance and revenue share tracking for a single product.",
    question: "Product insights for Olive Oil",
  },
  {
    icon: "💰",
    title: "Top Debtors",
    description: "Accounts with the largest outstanding balances.",
    question: "Who owes us the most money?",
  },
  {
    icon: "📈",
    title: "Sales Summary",
    description: "Aggregate sales performance for the period.",
    question: "Show sales summary",
  },
  {
    icon: "📊",
    title: "Dashboard Summary",
    description: "High-level KPIs and operational health at a glance.",
    question: "Show dashboard summary",
  },
  {
    icon: "⏰",
    title: "Overdue Invoices",
    description: "Aged receivables that require collection follow-up.",
    question: "Show overdue invoices",
  },
  {
    icon: "🧾",
    title: "Unpaid Invoices",
    description: "All outstanding invoices still awaiting payment.",
    question: "Show unpaid invoices",
  },
];
