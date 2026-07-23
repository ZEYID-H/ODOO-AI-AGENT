"use client";

import { STARTER_PROMPTS } from "@/lib/starterPrompts";
import StarterPrompt from "./StarterPrompt";

/**
 * The empty conversation state: a short welcome, one line of guidance, and
 * the six curated starter prompts. No duplicated sidebar list, no oversized
 * card grid, and — honestly — no claim that data is live while the backend
 * is demo data (see DataSourceStatus for the source of truth).
 */
export default function EmptyConversation({
  onSelect,
  disabled,
}: {
  onSelect: (question: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col justify-center px-4 py-10">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-ink">
          How can I help with your business today?
        </h2>
        <p className="mt-1.5 text-sm text-ink-dim">
          Ask about customers, invoices, sales, or overdue accounts — or start
          with one of these.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {STARTER_PROMPTS.map((prompt) => (
          <StarterPrompt
            key={prompt.label}
            prompt={prompt}
            onSelect={onSelect}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}
