"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import TopBar, { type ConnectionStatus } from "@/components/TopBar";
import ChatInput from "@/components/ChatInput";
import ResponseCard from "@/components/ResponseCard";
import EmptyState from "@/components/EmptyState";
import { getHealth, listTools, chat, ApiError } from "@/lib/api";
import { buildLightweightHistory, type ChatTurn } from "@/lib/history";
import {
  createConversation,
  loadConversation,
  renameConversation,
  deleteConversation,
  appendMessage,
  type ConversationSummary,
  type PersistedMessage,
} from "@/app/actions/conversations";

function toTurns(messages: PersistedMessage[]): ChatTurn[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/** Reflects a server-side title/updatedAt change into the locally-held list
 * without a round trip, keeping the sidebar's newest-first order correct. */
function touchConversation(
  list: ConversationSummary[],
  id: string,
  title?: string
): ConversationSummary[] {
  const now = new Date().toISOString();
  const touched = list.map((c) =>
    c.id === id ? { ...c, title: title ?? c.title, updatedAt: now } : c
  );
  return touched
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export default function DashboardClient({
  initialConversations,
  initialActiveId,
  initialMessages,
}: {
  initialConversations: ConversationSummary[];
  initialActiveId: string;
  initialMessages: PersistedMessage[];
}) {
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [activeId, setActiveId] = useState<string>(initialActiveId);
  const [turns, setTurns] = useState<ChatTurn[]>(() => toTurns(initialMessages));
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);

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
    if (loading || switching || !trimmed) return;

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

      // Persist both turns of a completed round trip — including a
      // success:false answer (still a real assistant reply, just styled as
      // an error). A thrown ApiError below is a transient network failure,
      // not a conversation turn, so it's deliberately never persisted.
      try {
        await Promise.all([
          appendMessage(activeId, "user", trimmed),
          appendMessage(activeId, "assistant", response.result),
        ]);
        setConversations((prev) => touchConversation(prev, activeId));
      } catch (persistErr) {
        console.error("Failed to save conversation turn:", persistErr);
      }
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

  async function handleNew() {
    if (loading || switching) return;
    setSwitching(true);
    try {
      const conv = await createConversation();
      setConversations((prev) => [conv, ...prev]);
      setActiveId(conv.id);
      setTurns([]);
    } catch (err) {
      console.error("Failed to create conversation:", err);
    } finally {
      setSwitching(false);
    }
  }

  async function handleSelect(id: string) {
    if (id === activeId || loading || switching) return;
    setSwitching(true);
    try {
      const conv = await loadConversation(id);
      if (conv) {
        setActiveId(id);
        setTurns(toTurns(conv.messages));
      }
    } catch (err) {
      console.error("Failed to load conversation:", err);
    } finally {
      setSwitching(false);
    }
  }

  async function handleRename(id: string, title: string) {
    try {
      await renameConversation(id, title);
      setConversations((prev) => touchConversation(prev, id, title));
    } catch (err) {
      console.error("Failed to rename conversation:", err);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteConversation(id);
    } catch (err) {
      console.error("Failed to delete conversation:", err);
      return;
    }

    const remaining = conversations.filter((c) => c.id !== id);

    if (remaining.length === 0) {
      // Never leave the user with zero conversations to select.
      setSwitching(true);
      try {
        const conv = await createConversation();
        setConversations([conv]);
        setActiveId(conv.id);
        setTurns([]);
      } finally {
        setSwitching(false);
      }
      return;
    }

    setConversations(remaining);
    if (id === activeId) {
      const next = remaining[0];
      setSwitching(true);
      try {
        const loaded = await loadConversation(next.id);
        setActiveId(next.id);
        setTurns(loaded ? toTurns(loaded.messages) : []);
      } finally {
        setSwitching(false);
      }
    }
  }

  const disabled = loading || switching;

  return (
    <div className="flex h-screen">
      <Sidebar
        status={status}
        toolCount={toolCount}
        onAsk={handleAsk}
        disabled={disabled}
        conversations={conversations}
        activeId={activeId}
        onSelectConversation={handleSelect}
        onNewConversation={handleNew}
        onRenameConversation={handleRename}
        onDeleteConversation={handleDelete}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar status={status} />

        <main className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {turns.length === 0 ? (
            <EmptyState onAsk={handleAsk} disabled={disabled} />
          ) : (
            turns.map((turn, i) => <ResponseCard key={i} turn={turn} />)
          )}

          {loading && (
            <div className="text-sm text-ink-dim animate-pulse">Thinking…</div>
          )}
        </main>

        <div className="border-t border-line px-6 py-4">
          <ChatInput onSubmit={handleAsk} disabled={disabled} />
        </div>
      </div>
    </div>
  );
}
