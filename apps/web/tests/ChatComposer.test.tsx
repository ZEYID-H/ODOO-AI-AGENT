// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import ChatComposer from "../components/ChatComposer";

function textarea() {
  return screen.getByLabelText("Ask a business question") as HTMLTextAreaElement;
}
function sendButton() {
  return screen.getByRole("button", { name: "Send message" });
}

describe("ChatComposer", () => {
  it("labels the textarea and the send button accessibly", () => {
    render(<ChatComposer onSubmit={vi.fn()} />);
    expect(textarea()).toBeInTheDocument();
    expect(sendButton()).toBeInTheDocument();
  });

  it("keeps send disabled and blocks submit while the field is empty", () => {
    const onSubmit = vi.fn();
    render(<ChatComposer onSubmit={onSubmit} />);
    expect(sendButton()).toBeDisabled();

    // Whitespace-only is still empty.
    fireEvent.change(textarea(), { target: { value: "   " } });
    expect(sendButton()).toBeDisabled();
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends the trimmed value on Enter", () => {
    const onSubmit = vi.fn();
    render(<ChatComposer onSubmit={onSubmit} />);
    fireEvent.change(textarea(), { target: { value: "  show overdue invoices  " } });
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("show overdue invoices");
  });

  it("inserts a newline (does not send) on Shift+Enter", () => {
    const onSubmit = vi.fn();
    render(<ChatComposer onSubmit={onSubmit} />);
    fireEvent.change(textarea(), { target: { value: "line one" } });
    fireEvent.keyDown(textarea(), { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears the field after sending, so the same text can't be double-submitted", () => {
    const onSubmit = vi.fn();
    render(<ChatComposer onSubmit={onSubmit} />);
    fireEvent.change(textarea(), { target: { value: "show sales summary" } });
    fireEvent.click(sendButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe("");
    // A follow-up click now has nothing to send.
    fireEvent.click(sendButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables the textarea and send button while a request is in flight", () => {
    const onSubmit = vi.fn();
    render(<ChatComposer onSubmit={onSubmit} disabled busy />);
    expect(textarea()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
  });

  it("documents the Enter / Shift+Enter keyboard behavior", () => {
    render(<ChatComposer onSubmit={vi.fn()} />);
    expect(screen.getByText(/to send/i)).toBeInTheDocument();
    expect(screen.getByText(/new line/i)).toBeInTheDocument();
  });
});
