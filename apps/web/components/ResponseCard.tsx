"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatTurn } from "@/lib/history";

export default function ResponseCard({ turn }: { turn: ChatTurn }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-xl bg-accent text-surface px-4 py-2 text-sm">
          {turn.content}
        </div>
      </div>
    );
  }

  if (turn.isError) {
    return (
      <div className="flex justify-start">
        <div
          role="alert"
          className="max-w-[85%] w-full rounded-xl border border-danger/40 bg-danger/10 px-4 py-3"
        >
          <div className="text-xs font-medium text-danger mb-1">⚠️ Error</div>
          <div className="text-sm text-danger">{turn.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] w-full rounded-xl border border-line bg-surface-2 px-4 py-3">
        {turn.tool && (
          <div className="text-xs text-ink-dim mb-2">
            🔧 Tool called: <code className="text-accent">{turn.tool}</code>
          </div>
        )}
        <div className="prose prose-invert prose-sm max-w-none prose-table:text-sm prose-th:text-ink prose-td:text-ink">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {turn.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
