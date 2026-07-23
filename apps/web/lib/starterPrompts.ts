/**
 * The empty-state starter prompts. Six, curated — each maps to a real,
 * route-verified tool question (dashboard, sales summary, top debtors,
 * overdue, customer insights, product insights). `icon` is a stable key
 * resolved to a Lucide icon in the StarterPrompt component, keeping this
 * module free of React so it stays trivially importable and testable.
 */

export interface StarterPrompt {
  icon: "gauge" | "trending-up" | "coins" | "clock" | "user-search" | "package-search";
  label: string;
  hint: string;
  question: string;
}

export const STARTER_PROMPTS: StarterPrompt[] = [
  {
    icon: "gauge",
    label: "Business health overview",
    hint: "KPIs and operational health at a glance",
    question: "Show dashboard summary",
  },
  {
    icon: "trending-up",
    label: "This month's sales",
    hint: "Revenue and top performers for the period",
    question: "Show sales summary",
  },
  {
    icon: "coins",
    label: "Who owes us the most?",
    hint: "Accounts ranked by outstanding balance",
    question: "Who owes us the most money?",
  },
  {
    icon: "clock",
    label: "Overdue invoices",
    hint: "Aged receivables due for follow-up",
    question: "Show overdue invoices",
  },
  {
    icon: "user-search",
    label: "Analyze a customer",
    hint: "Financial and behavioral profile for one account",
    question: "Customer insights for Apple Mart",
  },
  {
    icon: "package-search",
    label: "Analyze a product",
    hint: "Revenue share and performance for one product",
    question: "Product insights for Olive Oil",
  },
];
