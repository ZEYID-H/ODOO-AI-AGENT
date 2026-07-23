"use client";

import { Menu } from "lucide-react";
import DataSourceStatus from "./DataSourceStatus";
import type { ConnectionStatus } from "@/lib/data-source";

/**
 * The compact workspace header. Holds the mobile navigation trigger, the
 * current conversation's title (the single primary heading — the product
 * name lives only in the sidebar, never doubled here), and the one honest
 * data-source status.
 */
export default function WorkspaceHeader({
  title,
  status,
  onOpenNav,
}: {
  title: string;
  status: ConnectionStatus;
  onOpenNav: () => void;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-line px-3 py-2.5 sm:px-4">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="rounded-lg p-1.5 text-ink-dim transition hover:bg-surface-2 hover:text-ink md:hidden"
      >
        <Menu aria-hidden className="h-5 w-5" />
      </button>
      <h1
        dir="auto"
        className="min-w-0 flex-1 truncate text-sm font-medium text-ink"
      >
        {title}
      </h1>
      <DataSourceStatus status={status} className="shrink-0" />
    </header>
  );
}
