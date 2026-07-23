"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders an assistant answer's Markdown (the tool result string, unchanged)
 * with document-like typography from the tokens. Tables are wrapped in their
 * own horizontal scroll container so a wide business report never forces the
 * whole page to scroll sideways. `dir="auto"` lets Arabic content lay itself
 * out right-to-left inside an otherwise LTR shell.
 */
export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="message-prose" dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="scroll-region -mx-1 overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
