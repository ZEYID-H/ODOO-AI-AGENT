"use client";

import { Loader2 } from "lucide-react";

/** The assistant-is-working indicator. Restrained (a single spinner, no
 * bouncing), and an aria-live region so screen-reader users hear that a
 * response is being prepared. */
export default function LoadingMessage() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-sm text-ink-dim"
    >
      <Loader2
        aria-hidden
        className="h-4 w-4 animate-spin text-accent motion-reduce:animate-none"
      />
      <span>Thinking…</span>
    </div>
  );
}
