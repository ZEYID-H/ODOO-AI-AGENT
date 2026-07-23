"use client";

import { useState } from "react";
import { Copy, Check, RotateCcw } from "lucide-react";

/**
 * Subtle per-message actions. Copy is always available; Retry appears only
 * when a turn can be re-sent (a failed request). Both are real buttons with
 * accessible labels — never icon-only divs.
 */
export default function MessageActions({
  content,
  onRetry,
}: {
  content: string;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context / denied) — nothing to recover;
      // the button simply doesn't confirm rather than throwing at the user.
    }
  }

  const btn =
    "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-faint transition hover:text-ink hover:bg-surface-3 focus-visible:text-ink";

  return (
    <div className="mt-1.5 flex items-center gap-1">
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Response copied" : "Copy response"}
        className={btn}
      >
        {copied ? (
          <Check aria-hidden className="h-3.5 w-3.5 text-success" />
        ) : (
          <Copy aria-hidden className="h-3.5 w-3.5" />
        )}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>

      {onRetry && (
        <button type="button" onClick={onRetry} aria-label="Retry request" className={btn}>
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          <span>Retry</span>
        </button>
      )}
    </div>
  );
}
