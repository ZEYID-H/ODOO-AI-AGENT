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
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    const history = buildLightweightHistory(turns);
    setTurns((prev) => [...prev, { role: "user", content: query }]);
    setLoading(true);
    try {
      const response = await chat(query, history);
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: response.result,
          tool: response.success ? response.tool : null,
        },
      ]);
      if (!response.success) {
        setError("The assistant reported a problem processing that request.");
      }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Unexpected error contacting the API.";
      setError(message);
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ ${message}`, tool: null },
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
        onClear={() => {
          setTurns([]);
          setError(null);
        }}
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
            <div className="text-sm text-ink-dim animate-pulse">
              Thinking…
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
              {error}
            </div>
          )}
        </main>

        <div className="border-t border-line px-6 py-4">
          <ChatInput onSubmit={handleAsk} disabled={loading} />
        </div>
      </div>
    </div>
  );
}
