"use client";

import { QUICK_ACTIONS } from "@/lib/quickActions";
import QuickActionCard from "./QuickActionCard";

export default function EmptyState({
  onAsk,
  disabled,
}: {
  onAsk: (question: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">
          Ask a business question, or try one of these
        </h2>
        <p className="text-sm text-ink-dim">
          Every answer is read live from Odoo — nothing shown here is
          hardcoded.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {QUICK_ACTIONS.map((action) => (
          <QuickActionCard
            key={action.title}
            action={action}
            onAsk={onAsk}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}
