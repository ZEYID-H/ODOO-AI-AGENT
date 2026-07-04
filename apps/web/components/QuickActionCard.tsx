"use client";

import type { QuickAction } from "@/lib/quickActions";

export default function QuickActionCard({
  action,
  onAsk,
  disabled,
}: {
  action: QuickAction;
  onAsk: (question: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4 flex flex-col gap-2">
      <div className="font-medium text-ink">
        {action.icon} {action.title}
      </div>
      <p className="text-sm text-ink-dim flex-1">{action.description}</p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onAsk(action.question)}
        className="mt-2 w-full rounded-lg bg-surface border border-line py-2 text-sm text-ink hover:border-accent hover:text-accent transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Ask →
      </button>
    </div>
  );
}
