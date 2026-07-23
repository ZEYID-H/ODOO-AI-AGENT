"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { SendHorizontal } from "lucide-react";

const MAX_TEXTAREA_PX = 200;

/**
 * The message composer. A real multiline textarea that grows with its
 * content up to a cap (then scrolls), Enter to send, Shift+Enter for a
 * newline. The send control is a labelled button with an icon — never a
 * bare arrow — disabled while empty or while a request is in flight so a
 * question can't be double-sent.
 */
export default function ChatComposer({
  onSubmit,
  disabled,
  busy,
}: {
  onSubmit: (query: string) => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const empty = value.trim().length === 0;

  // Auto-grow: reset to auto so the box can shrink, then match content up to
  // the cap. useLayoutEffect avoids a visible flash between the two heights.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [value]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mx-auto w-full max-w-[880px]"
    >
      <div className="flex items-end gap-2 rounded-xl border border-line bg-surface-2 p-2 transition focus-within:border-line-strong">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          dir="auto"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a business question…"
          aria-label="Ask a business question"
          className="scroll-region flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || empty}
          aria-label="Send message"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent ps-3 pe-3 text-sm font-medium text-on-accent transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendHorizontal aria-hidden className="h-4 w-4 rtl:-scale-x-100" />
          <span className="hidden sm:inline">{busy ? "Sending…" : "Send"}</span>
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-ink-faint">
        <kbd className="font-sans">Enter</kbd> to send ·{" "}
        <kbd className="font-sans">Shift</kbd>+<kbd className="font-sans">Enter</kbd> for a new line
      </p>
    </form>
  );
}
