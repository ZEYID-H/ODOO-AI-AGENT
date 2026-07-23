"use client";

import { useEffect, useMemo, useState } from "react";
import ConversationSidebar from "@/components/ConversationSidebar";
import MobileSidebarDrawer from "@/components/MobileSidebarDrawer";
import WorkspaceHeader from "@/components/WorkspaceHeader";
import MessageList from "@/components/MessageList";
import EmptyConversation from "@/components/EmptyConversation";
import ChatComposer from "@/components/ChatComposer";
import { getHealth, listTools, chat, ApiError } from "@/lib/api";
import type { ConnectionStatus } from "@/lib/data-source";
import {
  buildLightweightHistory,
  type ChatTurn,
  type HistoryMessage,
} from "@/lib/history";
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
  return messages.map((m) => ({ id: m.id, role: m.role, content: m.content }));
}

/** Stable id for a freshly-added turn (not yet persisted / no db id yet). */
function newTurnId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Reflects a server-side title/updatedAt change into the locally-held list
 * without a round trip, keeping the sidebar's newest-first order correct. */
function touchConversation(
  list: ConversationSummary[],
  id: string,
  title?: string
): ConversationSummary[] {
  const now = new Date().toISOString();
  return list
    .map((c) => (c.id === id ? { ...c, title: title ?? c.title, updatedAt: now } : c))
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
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  const activeTitle = useMemo(
    () => conversations.find((c) => c.id === activeId)?.title ?? "New conversation",
    [conversations, activeId]
  );

  const disabled = loading || switching;

  /** Core send path. `baseTurns` is the history the request is built from —
   * the current thread for a normal ask, or the thread with the failed
   * exchange dropped for a retry. Explicit (not a functional setState) so the
   * history sent to the API is exactly the pre-request thread, with no race. */
  async function sendQuery(query: string, baseTurns: ChatTurn[]) {
    const trimmed = query.trim();
    if (loading || switching || !trimmed) return;

    const history: HistoryMessage[] = buildLightweightHistory(baseTurns);
    const withUser: ChatTurn[] = [
      ...baseTurns,
      { id: newTurnId(), role: "user", content: trimmed },
    ];
    setTurns(withUser);
    setLoading(true);

    try {
      const response = await chat(trimmed, history);
      setTurns([
        ...withUser,
        response.success
          ? { id: newTurnId(), role: "assistant", content: response.result, tool: response.tool }
          : { id: newTurnId(), role: "assistant", content: response.result, tool: null, isError: true },
      ]);

      // Persist a completed round trip (including a success:false answer — a
      // real assistant reply). A thrown ApiError below is a transient network
      // failure, not a turn, so it is deliberately never persisted.
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
      setTurns([
        ...withUser,
        {
          id: newTurnId(),
          role: "assistant",
          content: message,
          tool: null,
          isError: true,
          retryQuery: trimmed,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleAsk(query: string) {
    void sendQuery(query, turns);
  }

  /** Re-send a failed question: drop the trailing error turn and the user
   * turn that produced it (neither was persisted), then send fresh so the
   * history and persistence are exactly as if the failure never happened. */
  function handleRetry(query: string) {
    let base = turns.slice();
    if (base.length && base[base.length - 1].isError) base.pop();
    if (base.length && base[base.length - 1].role === "user") base.pop();
    void sendQuery(query, base);
  }

  async function handleNew() {
    if (disabled) return;
    setMobileNavOpen(false);
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
    setMobileNavOpen(false);
    if (id === activeId || disabled) return;
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

  const sidebarProps = {
    toolCount,
    conversations,
    activeId,
    onSelectConversation: handleSelect,
    onNewConversation: handleNew,
    onRenameConversation: handleRename,
    onDeleteConversation: handleDelete,
    disabled,
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-surface text-ink">
      {/* Desktop rail — collapsible */}
      <aside
        className={`hidden shrink-0 border-e border-line transition-[width] duration-200 md:block ${
          collapsed ? "w-16" : "w-72"
        }`}
      >
        <ConversationSidebar
          {...sidebarProps}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
      </aside>

      {/* Mobile drawer */}
      <MobileSidebarDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)}>
        <ConversationSidebar {...sidebarProps} onClose={() => setMobileNavOpen(false)} />
      </MobileSidebarDrawer>

      {/* Workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        <WorkspaceHeader
          title={activeTitle}
          status={status}
          onOpenNav={() => setMobileNavOpen(true)}
        />

        <main className="flex min-h-0 flex-1 flex-col">
          {turns.length === 0 ? (
            <div className="scroll-region min-h-0 flex-1 overflow-y-auto">
              <EmptyConversation onSelect={handleAsk} disabled={disabled} />
            </div>
          ) : (
            <MessageList turns={turns} loading={loading} onRetry={handleRetry} />
          )}
        </main>

        <div className="border-t border-line px-3 py-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]">
          <ChatComposer onSubmit={handleAsk} disabled={disabled} busy={loading} />
        </div>
      </div>
    </div>
  );
}
