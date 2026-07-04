import { describe, expect, it } from "vitest";
import { buildLightweightHistory, MAX_HISTORY_TURNS, type ChatTurn } from "../lib/history";

describe("buildLightweightHistory", () => {
  it("passes plain user text through unchanged", () => {
    const turns: ChatTurn[] = [{ role: "user", content: "how much does Apple Mart owe?" }];
    expect(buildLightweightHistory(turns)).toEqual([
      { role: "user", content: "how much does Apple Mart owe?" },
    ]);
  });

  it("keeps plain assistant text (no tool) unchanged", () => {
    const turns: ChatTurn[] = [{ role: "assistant", content: "Hi, how can I help?" }];
    expect(buildLightweightHistory(turns)).toEqual([
      { role: "assistant", content: "Hi, how can I help?" },
    ]);
  });

  it("collapses a tool-backed assistant turn to a short note, never the full result", () => {
    const bigMarkdownTable =
      "## Business Alerts\n\n| Rank | Customer | Overdue |\n|---|---|---|\n| 1 | Apple Mart | QAR 33,574.50 |";
    const turns: ChatTurn[] = [
      { role: "assistant", content: bigMarkdownTable, tool: "get_business_alerts" },
    ];
    const filtered = buildLightweightHistory(turns);
    expect(filtered).toEqual([
      { role: "assistant", content: "(Provided get_business_alerts results.)" },
    ]);
    // Explicitly confirm the ERP table/figures never reach the lightweight history.
    expect(filtered[0].content).not.toContain("QAR");
    expect(filtered[0].content).not.toContain("Apple Mart");
  });

  it("preserves turn order across a mixed conversation", () => {
    const turns: ChatTurn[] = [
      { role: "user", content: "how much does Apple Mart owe?" },
      { role: "assistant", content: "## Balance\n| Field | Value |\n|---|---|", tool: "get_customer_balance" },
      { role: "user", content: "show unpaid invoices too" },
    ];
    const filtered = buildLightweightHistory(turns);
    expect(filtered.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(filtered[1].content).toBe("(Provided get_customer_balance results.)");
  });

  it("caps history to the most recent MAX_HISTORY_TURNS turns by default", () => {
    const turns: ChatTurn[] = Array.from({ length: MAX_HISTORY_TURNS + 5 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i}`,
    }));
    const filtered = buildLightweightHistory(turns);
    expect(filtered).toHaveLength(MAX_HISTORY_TURNS);
    // Keeps the tail (most recent), not the head.
    expect(filtered[filtered.length - 1].content).toBe(`turn ${turns.length - 1}`);
    expect(filtered[0].content).toBe(`turn ${turns.length - MAX_HISTORY_TURNS}`);
  });

  it("respects an explicit maxTurns override", () => {
    const turns: ChatTurn[] = Array.from({ length: 5 }, (_, i) => ({
      role: "user",
      content: `turn ${i}`,
    }));
    expect(buildLightweightHistory(turns, 2)).toEqual([
      { role: "user", content: "turn 3" },
      { role: "user", content: "turn 4" },
    ]);
  });

  it("returns an empty array for an empty conversation", () => {
    expect(buildLightweightHistory([])).toEqual([]);
  });
});
