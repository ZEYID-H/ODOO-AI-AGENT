// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Sidebar imports logoutAction, which pulls in the real auth.ts -> next-auth
// module graph. These tests only exercise UI wiring, not Auth.js itself, so
// it's mocked out here the same way @/lib/api is mocked in DashboardPage
// tests — isolating the unit under test from an unrelated real dependency.
vi.mock("@/app/actions/auth", () => ({
  loginAction: vi.fn(),
  logoutAction: vi.fn(),
}));

import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";

const conversationProps = {
  conversations: [],
  activeId: null,
  onSelectConversation: vi.fn(),
  onNewConversation: vi.fn(),
  onRenameConversation: vi.fn(),
  onDeleteConversation: vi.fn(),
};

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
      <Sidebar status="checking" toolCount={null} onAsk={vi.fn()} {...conversationProps} />
    );
    // Backend badge and tool count both render their "unknown" placeholder.
    expect(screen.getAllByText("…").length).toBeGreaterThanOrEqual(1);
  });

  it("shows CONNECTED and the live tool count once both calls resolve", () => {
    render(
      <Sidebar status="online" toolCount={14} onAsk={vi.fn()} {...conversationProps} />
    );
    expect(screen.getByText("CONNECTED")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
  });

  it("shows OFFLINE when the backend is unreachable", () => {
    render(
      <Sidebar status="offline" toolCount={null} onAsk={vi.fn()} {...conversationProps} />
    );
    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
  });

  it("invokes onAsk with the quick action's question when clicked", () => {
    const onAsk = vi.fn();
    render(
      <Sidebar status="online" toolCount={14} onAsk={onAsk} {...conversationProps} />
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
        {...conversationProps}
        disabled
      />
    );
    const button = screen.getByText(/Business Alerts/).closest("button");
    expect(button).toBeDisabled();
  });
});

describe("Sidebar — conversation list wiring", () => {
  const conversations = [
    { id: "c1", title: "First chat", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "c2", title: "Second chat", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
  ];

  it("renders each conversation and invokes onSelectConversation when clicked", () => {
    const onSelectConversation = vi.fn();
    render(
      <Sidebar
        status="online"
        toolCount={14}
        onAsk={vi.fn()}
        {...conversationProps}
        conversations={conversations}
        activeId="c1"
        onSelectConversation={onSelectConversation}
      />
    );
    expect(screen.getByText("First chat")).toBeInTheDocument();
    expect(screen.getByText("Second chat")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Second chat"));
    expect(onSelectConversation).toHaveBeenCalledWith("c2");
  });

  it("invokes onNewConversation when New Chat is clicked", () => {
    const onNewConversation = vi.fn();
    render(
      <Sidebar
        status="online"
        toolCount={14}
        onAsk={vi.fn()}
        {...conversationProps}
        conversations={conversations}
        activeId="c1"
        onNewConversation={onNewConversation}
      />
    );
    fireEvent.click(screen.getByText(/New Chat/));
    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });
});
