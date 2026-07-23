"use client";

import { Database, FlaskConical, Loader2, Unplug } from "lucide-react";
import { resolveDataSource, type ConnectionStatus } from "@/lib/data-source";

/**
 * The one place the workspace states where its answers come from. Text +
 * icon + shape carry the meaning (never color alone), and it is honest by
 * construction: `resolveDataSource` can only return "odoo" when a live
 * instance is actually wired and reachable — mock never masquerades as live.
 */

const PRESENTATION = {
  connecting: {
    Icon: Loader2,
    label: "Connecting",
    detail: "Checking the assistant service…",
    tone: "text-ink-dim",
    dot: "bg-ink-faint",
    spin: true,
  },
  demo: {
    Icon: FlaskConical,
    label: "Demo data",
    detail: "Answers use bundled sample data — not a live Odoo instance.",
    tone: "text-warn",
    dot: "bg-warn",
    spin: false,
  },
  odoo: {
    Icon: Database,
    label: "Connected to Odoo",
    detail: "Answers read from a live Odoo instance.",
    tone: "text-success",
    dot: "bg-success",
    spin: false,
  },
  "api-unavailable": {
    Icon: Unplug,
    label: "Service unavailable",
    detail: "Can't reach the assistant service. Is the backend running?",
    tone: "text-danger",
    dot: "bg-danger",
    spin: false,
  },
} as const;

export default function DataSourceStatus({
  status,
  className = "",
}: {
  status: ConnectionStatus;
  className?: string;
}) {
  const state = resolveDataSource(status);
  const { Icon, label, detail, tone, dot, spin } = PRESENTATION[state];

  return (
    <span
      role="status"
      aria-live="polite"
      title={detail}
      className={`inline-flex items-center gap-2 rounded-full border border-line bg-surface-2 ps-2.5 pe-3 py-1 text-xs font-medium ${tone} ${className}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <Icon
        aria-hidden
        className={`h-3.5 w-3.5 ${spin ? "animate-spin motion-reduce:animate-none" : ""}`}
      />
      <span>{label}</span>
    </span>
  );
}
