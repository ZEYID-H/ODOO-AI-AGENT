/**
 * Lightweight, text-only conversation memory — the frontend mirror of
 * app.py's `_build_history()`.
 *
 * This is NOT agent/tool logic (nothing here decides which tool runs, and
 * nothing here touches Odoo). It is UI-state hygiene: the full chat log
 * (`ChatTurn[]`) keeps the rendered markdown for display, but only a
 * lightweight {role, content} history is ever sent back to the API —
 * never a full tool-output table. The API also independently re-applies
 * an equivalent filter server-side (defense in depth; see
 * apps/api/main.py::filter_history and docs/SAAS_MIGRATION_PLAN.md §9).
 */

export type Role = "user" | "assistant";

/** A single turn as rendered in the UI (full markdown result kept here). */
export interface ChatTurn {
  role: Role;
  content: string;
  tool?: string | null;
  /** True for a failed request/response — lets ResponseCard style it distinctly. */
  isError?: boolean;
}

/** The lightweight shape sent to the API — matches apps/api ChatMessage. */
export interface HistoryMessage {
  role: Role;
  content: string;
}

/** Bounds how much history is ever sent per request. Unbounded history would
 * grow every LLM call's payload (and cost/latency) as a session gets long;
 * only the most recent turns are needed to resolve short-term references
 * like "show unpaid invoices too". */
export const MAX_HISTORY_TURNS = 12;

export function buildLightweightHistory(
  turns: ChatTurn[],
  maxTurns: number = MAX_HISTORY_TURNS
): HistoryMessage[] {
  const recent = maxTurns > 0 ? turns.slice(-maxTurns) : turns;
  return recent.map((turn) => {
    if (turn.role === "assistant" && turn.tool) {
      return { role: "assistant", content: `(Provided ${turn.tool} results.)` };
    }
    return { role: turn.role, content: turn.content };
  });
}
