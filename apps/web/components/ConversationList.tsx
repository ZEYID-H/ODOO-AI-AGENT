"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { ConversationSummary } from "@/app/actions/conversations";

/**
 * The scrollable conversation history. Renders only the list — the "New
 * conversation" action and the scroll container live in ConversationSidebar,
 * so this has no scrollbar of its own (removing the old nested-scroll
 * problem). The active item is obvious both visually and via aria-current.
 */
export default function ConversationList({
  conversations,
  activeId,
  onSelect,
  onRename,
  onDelete,
  disabled,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
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
    if (editingId && trimmed) onRename(editingId, trimmed);
    setEditingId(null);
  }

  function handleDelete(conv: ConversationSummary) {
    if (window.confirm(`Delete "${conv.title}"? This cannot be undone.`)) {
      onDelete(conv.id);
    }
  }

  if (conversations.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-xs text-ink-faint">
        No conversations yet. Start by asking a question.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {conversations.map((conv) => {
        const isActive = conv.id === activeId;
        const isEditing = editingId === conv.id;

        if (isEditing) {
          return (
            <li key={conv.id}>
              <input
                autoFocus
                value={draftTitle}
                disabled={disabled}
                dir="auto"
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={commitEditing}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEditing();
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="w-full rounded-lg border border-accent bg-surface px-2.5 py-2 text-sm text-ink outline-none"
              />
            </li>
          );
        }

        return (
          <li key={conv.id}>
            <div
              className={`group relative flex items-center rounded-lg border-s-2 transition ${
                isActive
                  ? "border-accent bg-surface-3"
                  : "border-transparent hover:bg-surface-2"
              }`}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(conv.id)}
                aria-current={isActive ? "true" : undefined}
                title={conv.title}
                dir="auto"
                className={`min-w-0 flex-1 truncate ps-2.5 pe-2 py-2 text-start text-sm disabled:cursor-not-allowed ${
                  isActive ? "text-ink" : "text-ink-dim group-hover:text-ink"
                }`}
              >
                {conv.title}
              </button>
              {/* group-focus-within/focus-visible reveal these on keyboard
                  focus too — hover alone would hide them from Tab users. */}
              <span className="flex shrink-0 items-center pe-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  aria-label={`Rename ${conv.title}`}
                  disabled={disabled}
                  onClick={() => startEditing(conv)}
                  className="rounded p-1 text-ink-faint hover:text-accent focus-visible:opacity-100 disabled:cursor-not-allowed"
                >
                  <Pencil aria-hidden className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${conv.title}`}
                  disabled={disabled}
                  onClick={() => handleDelete(conv)}
                  className="rounded p-1 text-ink-faint hover:text-danger focus-visible:opacity-100 disabled:cursor-not-allowed"
                >
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
