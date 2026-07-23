// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import EmptyConversation from "../components/EmptyConversation";
import { STARTER_PROMPTS } from "../lib/starterPrompts";

describe("EmptyConversation", () => {
  it("greets the user and offers exactly the curated starter prompts", () => {
    render(<EmptyConversation onSelect={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: /How can I help with your business today/ })
    ).toBeInTheDocument();
    for (const prompt of STARTER_PROMPTS) {
      expect(screen.getByText(prompt.label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button")).toHaveLength(STARTER_PROMPTS.length);
  });

  it("submits the mapped question when a starter prompt is clicked", () => {
    const onSelect = vi.fn();
    render(<EmptyConversation onSelect={onSelect} />);
    const first = STARTER_PROMPTS[0];
    fireEvent.click(screen.getByText(first.label));
    expect(onSelect).toHaveBeenCalledWith(first.question);
  });

  it("does not make a dishonest live-Odoo claim while on demo data", () => {
    render(<EmptyConversation onSelect={vi.fn()} />);
    expect(screen.queryByText(/read live from Odoo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing shown here is hardcoded/i)).not.toBeInTheDocument();
  });
});
