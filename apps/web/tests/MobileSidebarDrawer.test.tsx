// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import MobileSidebarDrawer from "../components/MobileSidebarDrawer";

describe("MobileSidebarDrawer", () => {
  it("renders nothing while closed", () => {
    render(
      <MobileSidebarDrawer open={false} onClose={vi.fn()}>
        <button>Inside</button>
      </MobileSidebarDrawer>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Inside")).not.toBeInTheDocument();
  });

  it("renders a modal dialog with its content when open", () => {
    render(
      <MobileSidebarDrawer open onClose={vi.fn()}>
        <button>Inside</button>
      </MobileSidebarDrawer>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Inside")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <MobileSidebarDrawer open onClose={onClose}>
        <button>Inside</button>
      </MobileSidebarDrawer>
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <MobileSidebarDrawer open onClose={onClose}>
        <button>Inside</button>
      </MobileSidebarDrawer>
    );
    fireEvent.click(screen.getByTestId("drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks background scroll while open and restores it on close", () => {
    const { rerender } = render(
      <MobileSidebarDrawer open onClose={vi.fn()}>
        <button>Inside</button>
      </MobileSidebarDrawer>
    );
    expect(document.body.style.overflow).toBe("hidden");
    rerender(
      <MobileSidebarDrawer open={false} onClose={vi.fn()}>
        <button>Inside</button>
      </MobileSidebarDrawer>
    );
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});
