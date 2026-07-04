"use client";

import { useState, type KeyboardEvent } from "react";

export default function ChatInput({
  onSubmit,
  disabled,
}: {
  onSubmit: (query: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask a business question..."
        className="flex-1 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent disabled:opacity-60"
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled || !value.trim()}
        className="rounded-lg bg-accent text-surface px-4 py-3 text-sm font-medium hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        ↑
      </button>
    </div>
  );
}
