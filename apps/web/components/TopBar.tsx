"use client";

type ConnectionStatus = "checking" | "online" | "offline";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  checking: "Checking API…",
  online: "API Connected",
  offline: "API Unreachable",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
  checking: "bg-warn",
  online: "bg-accent",
  offline: "bg-danger",
};

export default function TopBar({ status }: { status: ConnectionStatus }) {
  return (
    <header className="flex items-center justify-between border-b border-line px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">
          Odoo Business Intelligence Assistant
        </h1>
        <p className="text-xs text-ink-dim">
          Read-only AI assistant for business analytics and reporting
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs text-ink-dim">
        <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
        {STATUS_LABEL[status]}
      </div>
    </header>
  );
}

export type { ConnectionStatus };
