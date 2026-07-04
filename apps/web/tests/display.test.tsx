// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";

describe("TopBar — connection status display", () => {
  it("shows a checking indicator while the health check is in flight", () => {
    render(<TopBar status="checking" />);
    expect(screen.getByText("Checking API…")).toBeInTheDocument();
  });

  it("shows connected once /health has resolved", () => {
    render(<TopBar status="online" />);
    expect(screen.getByText("API Connected")).toBeInTheDocument();
  });

  it("shows unreachable if /health failed", () => {
    render(<TopBar status="offline" />);
    expect(screen.getByText("API Unreachable")).toBeInTheDocument();
  });
});

describe("Sidebar — connection + tool count display", () => {
  it("shows a placeholder while backend/tool count are unknown", () => {
    render(
      <Sidebar status="checking" toolCount={null} onAsk={vi.fn()} onClear={vi.fn()} />
    );
    // Backend badge and tool count both render their "unknown" placeholder.
    expect(screen.getAllByText("…").length).toBeGreaterThanOrEqual(1);
  });

  it("shows CONNECTED and the live tool count once both calls resolve", () => {
    render(
      <Sidebar status="online" toolCount={14} onAsk={vi.fn()} onClear={vi.fn()} />
    );
    expect(screen.getByText("CONNECTED")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
  });

  it("shows OFFLINE when the backend is unreachable", () => {
    render(
      <Sidebar status="offline" toolCount={null} onAsk={vi.fn()} onClear={vi.fn()} />
    );
    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
  });

  it("invokes onAsk with the quick action's question when clicked", () => {
    const onAsk = vi.fn();
    render(
      <Sidebar status="online" toolCount={14} onAsk={onAsk} onClear={vi.fn()} />
    );
    fireEvent.click(screen.getByText(/Business Alerts/));
    expect(onAsk).toHaveBeenCalledWith("Show business alerts");
  });

  it("disables quick-question buttons while a request is in flight", () => {
    render(
      <Sidebar
        status="online"
        toolCount={14}
        onAsk={vi.fn()}
        onClear={vi.fn()}
        disabled
      />
    );
    const button = screen.getByText(/Business Alerts/).closest("button");
    expect(button).toBeDisabled();
  });

  it("invokes onClear when Clear Chat is clicked", () => {
    const onClear = vi.fn();
    render(
      <Sidebar status="online" toolCount={14} onAsk={vi.fn()} onClear={onClear} />
    );
    fireEvent.click(screen.getByText(/Clear Chat/));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
