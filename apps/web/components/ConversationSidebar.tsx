"use client";

import Link from "next/link";
import {
  BarChart3,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Truck,
  LogOut,
  Wrench,
} from "lucide-react";
import ConversationList from "@/components/ConversationList";
import { logoutAction } from "@/app/actions/auth";
import type { ConversationSummary } from "@/app/actions/conversations";

/**
 * The conversation sidebar's inner content — shared by the desktop rail and
 * the mobile drawer. One intentional scroll region (the history). No
 * duplicated quick-questions, no debug connection block. When `collapsed`
 * (desktop only) it becomes a 64px icon rail; labels stay reachable through
 * aria-labels and titles.
 */
export default function ConversationSidebar({
  toolCount,
  conversations,
  activeId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
  disabled,
  collapsed = false,
  onToggleCollapse,
  onClose,
}: {
  toolCount: number | null;
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  disabled?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onClose?: () => void;
}) {
  const footerBtn =
    "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-dim transition hover:bg-surface-2 hover:text-ink";

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* Brand + collapse/close control */}
      <div className="flex items-center gap-2 px-3 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <BarChart3 aria-hidden className="h-5 w-5" />
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            Odoo BI Assistant
          </span>
        )}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-lg p-1.5 text-ink-dim transition hover:bg-surface-2 hover:text-ink"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        ) : onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className={`rounded-lg p-1.5 text-ink-dim transition hover:bg-surface-2 hover:text-ink ${
              collapsed ? "mx-auto" : ""
            }`}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden className="h-5 w-5" />
            ) : (
              <PanelLeftClose aria-hidden className="h-5 w-5" />
            )}
          </button>
        ) : null}
      </div>

      {/* New conversation — the primary sidebar action */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onNewConversation}
          disabled={disabled}
          aria-label="New conversation"
          className={`flex w-full items-center gap-2 rounded-lg border border-line bg-surface-2 py-2 text-sm font-medium text-ink transition hover:border-line-strong hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50 ${
            collapsed ? "justify-center px-0" : "px-3"
          }`}
        >
          <Plus aria-hidden className="h-4 w-4 shrink-0 text-accent" />
          {!collapsed && <span>New conversation</span>}
        </button>
      </div>

      {/* History — the single scroll region */}
      {!collapsed ? (
        <nav
          aria-label="Conversation history"
          className="scroll-region min-h-0 flex-1 overflow-y-auto px-2 py-1"
        >
          <ConversationList
            conversations={conversations}
            activeId={activeId}
            onSelect={onSelectConversation}
            onRename={onRenameConversation}
            onDelete={onDeleteConversation}
            disabled={disabled}
          />
        </nav>
      ) : (
        <div className="flex-1" />
      )}

      {/* Footer: capability count + navigation + account */}
      <div className="mt-auto border-t border-line px-3 py-3">
        {!collapsed && (
          <div className="mb-2 flex items-center gap-1.5 px-2.5 text-xs text-ink-faint">
            <Wrench aria-hidden className="h-3 w-3" />
            <span className="tabular">{toolCount ?? "…"}</span>
            <span>tools available</span>
          </div>
        )}
        <Link
          href="/dashboard/delivery-proof"
          aria-label="Delivery proof review"
          title="Delivery proof review"
          className={`${footerBtn} ${collapsed ? "justify-center" : ""}`}
        >
          <Truck aria-hidden className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Delivery review</span>}
        </Link>
        <form action={logoutAction}>
          <button
            type="submit"
            aria-label="Log out"
            title="Log out"
            className={`${footerBtn} w-full ${collapsed ? "justify-center" : ""}`}
          >
            <LogOut aria-hidden className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Log out</span>}
          </button>
        </form>
      </div>
    </div>
  );
}
