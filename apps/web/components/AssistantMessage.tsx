"use client";

import { Wrench } from "lucide-react";
import MarkdownMessage from "./MarkdownMessage";
import MessageActions from "./MessageActions";
import type { ChatTurn } from "@/lib/history";

/**
 * An assistant answer, rendered as a document on the surface — not boxed in
 * a heavy card. A subtle badge names the tool that produced it (honest
 * traceability), and Copy is always offered.
 */
export default function AssistantMessage({ turn }: { turn: ChatTurn }) {
  return (
    <div>
      {turn.tool && (
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-surface-2 ps-2 pe-2.5 py-0.5 text-[11px] font-medium text-ink-dim">
          <Wrench aria-hidden className="h-3 w-3 text-accent" />
          <span className="tabular">{turn.tool}</span>
        </div>
      )}
      <MarkdownMessage content={turn.content} />
      <MessageActions content={turn.content} />
    </div>
  );
}
