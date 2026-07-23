"use client";

import { AlertTriangle } from "lucide-react";
import MessageActions from "./MessageActions";
import type { ChatTurn } from "@/lib/history";

/**
 * A failed or error answer. Keeps role="alert" so assistive tech announces
 * it, states what happened plainly, and — for a transient network failure
 * (which carries a retryQuery) — offers a one-click Retry.
 */
export default function ErrorMessage({
  turn,
  onRetry,
}: {
  turn: ChatTurn;
  onRetry?: (query: string) => void;
}) {
  const retryQuery = turn.retryQuery;
  return (
    <div
      role="alert"
      className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3"
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-danger">
        <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
        Something went wrong
      </div>
      <div dir="auto" className="text-sm text-ink">
        {turn.content}
      </div>
      <MessageActions
        content={turn.content}
        onRetry={retryQuery && onRetry ? () => onRetry(retryQuery) : undefined}
      />
    </div>
  );
}
