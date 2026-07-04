"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import TopBar, { type ConnectionStatus } from "@/components/TopBar";
import ChatInput from "@/components/ChatInput";
import ResponseCard from "@/components/ResponseCard";
import EmptyState from "@/components/EmptyState";
import { getHealth, listTools, chat, ApiError } from "@/lib/api";
import { buildLightweightHistory, type ChatTurn } from "@/lib/history";

export default function DashboardPage() {
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);

  // Required: the frontend calls /health and /tools on load, and /chat on
  // every question — all three FastAPI endpoints, no tool logic duplicated.
  useEffect(() => {
    getHealth()
      .then(() => setStatus("online"))
      .catch(() => setStatus("offline"));

    listTools()
      .then((res) => setToolCount(res.count))
      .catch(() => setToolCount(null));
  }, []);

  async function handleAsk(query: string) {
    // Guards against both a double-submit race (rapid double-click/Enter
    // before the disabled prop re-renders) and an empty/whitespace-only
    // message reaching the API, independent of ChatInput's own check.
    const trimmed = query.trim();
    if (loading || !trimmed) return;

    const history = buildLightweightHistory(turns);
    setTurns((prev) => [...prev, { role: "user", content: trimmed }]);
    setLoading(true);
    try {
      const response = await chat(trimmed, history);
      setTurns((prev) => [
        ...prev,
        response.success
          ? { role: "assistant", content: response.result, tool: response.tool }
          : { role: "assistant", content: response.result, tool: null, isError: true },
      ]);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Unexpected error contacting the API.";
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: message, tool: null, isError: true },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        status={status}
        toolCount={toolCount}
        onAsk={handleAsk}
        onClear={() => setTurns([])}
        disabled={loading}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar status={status} />

        <main className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {turns.length === 0 ? (
            <EmptyState onAsk={handleAsk} disabled={loading} />
          ) : (
            turns.map((turn, i) => <ResponseCard key={i} turn={turn} />)
          )}

          {loading && (
            <div className="text-sm text-ink-dim animate-pulse">Thinking…</div>
          )}
        </main>

        <div className="border-t border-line px-6 py-4">
          <ChatInput onSubmit={handleAsk} disabled={loading} />
        </div>
      </div>
    </div>
  );
}
