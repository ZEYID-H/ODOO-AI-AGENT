"use client";

import {
  Gauge,
  TrendingUp,
  Coins,
  Clock,
  UserSearch,
  PackageSearch,
  type LucideIcon,
} from "lucide-react";
import type { StarterPrompt as Prompt } from "@/lib/starterPrompts";

const ICONS: Record<Prompt["icon"], LucideIcon> = {
  gauge: Gauge,
  "trending-up": TrendingUp,
  coins: Coins,
  clock: Clock,
  "user-search": UserSearch,
  "package-search": PackageSearch,
};

export default function StarterPrompt({
  prompt,
  onSelect,
  disabled,
}: {
  prompt: Prompt;
  onSelect: (question: string) => void;
  disabled?: boolean;
}) {
  const Icon = ICONS[prompt.icon];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(prompt.question)}
      className="group flex items-start gap-3 rounded-lg border border-line bg-surface-2 ps-3 pe-3 py-2.5 text-start transition hover:border-line-strong hover:bg-surface-3 focus-visible:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Icon
        aria-hidden
        className="mt-0.5 h-4 w-4 shrink-0 text-ink-dim transition group-hover:text-accent"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{prompt.label}</span>
        <span className="block text-xs text-ink-dim">{prompt.hint}</span>
      </span>
    </button>
  );
}
