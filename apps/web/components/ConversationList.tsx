"use client";

import { useState } from "react";
import type { ConversationSummary } from "@/app/actions/conversations";

export default function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  disabled,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  function startEditing(conv: ConversationSummary) {
    setEditingId(conv.id);
    setDraftTitle(conv.title);
  }

  function commitEditing() {
    const trimmed = draftTitle.trim();
    if (editingId && trimmed) {
      onRename(editingId, trimmed);
    }
    setEditingId(null);
  }

  function handleDelete(conv: ConversationSummary) {
    if (window.confirm(`Delete "${conv.title}"? This cannot be undone.`)) {
      onDelete(conv.id);
    }
  }

  return (
    <div className="border-t border-line pt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium text-ink text-xs">Conversations</div>
        <button
          type="button"
          onClick={onNew}
          disabled={disabled}
          className="text-xs rounded-lg border border-line px-2 py-1 text-ink-dim hover:border-accent hover:text-accent transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + New Chat
        </button>
      </div>

      <ul className="flex flex-col gap-1 max-h-64 overflow-y-auto">
        {conversations.length === 0 && (
          <li className="text-xs text-ink-dim px-1 py-1">No conversations yet.</li>
        )}
        {conversations.map((conv) => {
          const isActive = conv.id === activeId;
          const isEditing = editingId === conv.id;

          return (
            <li key={conv.id}>
              {isEditing ? (
                <input
                  autoFocus
                  value={draftTitle}
                  disabled={disabled}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={commitEditing}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEditing();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-full text-xs rounded-lg border border-accent bg-surface px-2 py-1.5 text-ink outline-none"
                />
              ) : (
                <div
                  className={`group flex items-center gap-1 rounded-lg border px-2 py-1.5 transition ${
                    isActive
                      ? "border-accent bg-surface text-accent"
                      : "border-line bg-surface text-ink-dim hover:text-ink"
                  }`}
                >
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelect(conv.id)}
                    aria-current={isActive ? "true" : undefined}
                    className="flex-1 min-w-0 text-left text-xs truncate disabled:cursor-not-allowed"
                    title={conv.title}
                  >
                    {conv.title}
                  </button>
                  {/* group-hover alone leaves these invisible while genuinely
                      keyboard-focused (Tab doesn't trigger :hover) — a real
                      WCAG focus-visibility failure. group-focus-within/
                      focus-visible make them appear on keyboard focus too. */}
                  <button
                    type="button"
                    aria-label={`Rename ${conv.title}`}
                    disabled={disabled}
                    onClick={() => startEditing(conv)}
                    className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-xs px-1 hover:text-accent disabled:cursor-not-allowed"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${conv.title}`}
                    disabled={disabled}
                    onClick={() => handleDelete(conv)}
                    className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-xs px-1 hover:text-danger disabled:cursor-not-allowed"
                  >
                    🗑️
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
