"use client";

import type { ChatTurn } from "@/lib/history";

/** A user's question — a restrained bubble on an elevated surface, aligned to
 * the inline-end. Neutral, not accent-filled: the emerald is spent on
 * actions, not on every line the user types. */
export default function UserMessage({ turn }: { turn: ChatTurn }) {
  return (
    <div className="flex justify-end">
      <div
        dir="auto"
        className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-sm bg-surface-3 px-4 py-2.5 text-sm text-ink"
      >
        {turn.content}
      </div>
    </div>
  );
}
