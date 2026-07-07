"use client";

import { QUICK_ACTIONS } from "@/lib/quickActions";
import { logoutAction } from "@/app/actions/auth";
import ConversationList from "@/components/ConversationList";
import type { ConversationSummary } from "@/app/actions/conversations";
import type { ConnectionStatus } from "./TopBar";

export default function Sidebar({
  status,
  toolCount,
  onAsk,
  disabled,
  conversations,
  activeId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
}: {
  status: ConnectionStatus;
  toolCount: number | null;
  onAsk: (question: string) => void;
  disabled?: boolean;
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
}) {
  return (
    <aside className="w-72 shrink-0 border-r border-line bg-surface-2 p-5 flex flex-col gap-6 overflow-y-auto">
      <div>
        <div className="font-semibold text-ink">📊 Odoo BI Assistant</div>
        <p className="text-xs text-ink-dim mt-1">
          Read-only Business Intelligence &amp; ERP Assistant
        </p>
      </div>

      <div className="border-t border-line pt-4 space-y-1 text-xs text-ink-dim">
        <div className="font-medium text-ink mb-1">Connection</div>
        <div>
          Backend:{" "}
          <span className="px-1.5 py-0.5 rounded bg-surface border border-line text-accent">
            {status === "online" ? "CONNECTED" : status === "offline" ? "OFFLINE" : "…"}
          </span>
        </div>
        <div>Access: ✅ Read-Only</div>
        <div>Tools available: <span className="text-ink">{toolCount ?? "…"}</span></div>
      </div>

      <ConversationList
        conversations={conversations}
        activeId={activeId}
        onSelect={onSelectConversation}
        onNew={onNewConversation}
        onRename={onRenameConversation}
        onDelete={onDeleteConversation}
        disabled={disabled}
      />

      <div className="border-t border-line pt-4">
        <div className="font-medium text-ink text-xs mb-2">Quick Questions</div>
        <div className="flex flex-col gap-1.5">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.title}
              type="button"
              disabled={disabled}
              onClick={() => onAsk(action.question)}
              className="text-left text-xs rounded-lg border border-line bg-surface px-3 py-2 text-ink-dim hover:border-accent hover:text-accent transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {action.icon} {action.title}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-line pt-4 mt-auto space-y-1.5">
        <form action={logoutAction}>
          <button
            type="submit"
            className="w-full text-xs rounded-lg border border-line px-3 py-2 text-ink-dim hover:text-ink transition"
          >
            🚪 Log Out
          </button>
        </form>
      </div>
    </aside>
  );
}
