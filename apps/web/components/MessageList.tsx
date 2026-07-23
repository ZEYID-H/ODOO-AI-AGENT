"use client";

import { useEffect, useRef } from "react";
import type { ChatTurn } from "@/lib/history";
import UserMessage from "./UserMessage";
import AssistantMessage from "./AssistantMessage";
import ErrorMessage from "./ErrorMessage";
import LoadingMessage from "./LoadingMessage";

/**
 * The conversation thread — and the ONLY scroll container in the workspace
 * (the page itself never scrolls). Auto-scrolls to the newest turn.
 */
export default function MessageList({
  turns,
  loading,
  onRetry,
}: {
  turns: ChatTurn[];
  loading: boolean;
  onRetry: (query: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = endRef.current;
    // Guarded: jsdom (tests) doesn't lay out or always implement this.
    if (el && typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ behavior: "smooth", block: "end" });
      } catch {
        /* no-op in non-layout environments */
      }
    }
  }, [turns, loading]);

  return (
    <div className="scroll-region min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[880px] space-y-5 px-4 py-6">
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <UserMessage key={turn.id ?? i} turn={turn} />
          ) : turn.isError ? (
            <ErrorMessage key={turn.id ?? i} turn={turn} onRetry={onRetry} />
          ) : (
            <AssistantMessage key={turn.id ?? i} turn={turn} />
          )
        )}
        {loading && <LoadingMessage />}
        <div ref={endRef} />
      </div>
    </div>
  );
}
