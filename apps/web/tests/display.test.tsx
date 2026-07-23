// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ConversationSidebar imports logoutAction, which pulls in the real auth.ts
// -> next-auth module graph. These tests exercise UI wiring, not Auth.js, so
// it's mocked out here.
vi.mock("@/app/actions/auth", () => ({
  loginAction: vi.fn(),
  logoutAction: vi.fn(),
}));

import DataSourceStatus from "../components/DataSourceStatus";
import WorkspaceHeader from "../components/WorkspaceHeader";
import ConversationSidebar from "../components/ConversationSidebar";

const sidebarProps = {
  toolCount: 14 as number | null,
  conversations: [],
  activeId: null,
  onSelectConversation: vi.fn(),
  onNewConversation: vi.fn(),
  onRenameConversation: vi.fn(),
  onDeleteConversation: vi.fn(),
};

describe("DataSourceStatus — honest connection state", () => {
  it("shows a connecting state while the health check is in flight", () => {
    render(<DataSourceStatus status="checking" />);
    expect(screen.getByText("Connecting")).toBeInTheDocument();
  });

  it("shows demo-data (never a live-Odoo claim) when online on the mock backend", () => {
    render(<DataSourceStatus status="online" />);
    expect(screen.getByText("Demo data")).toBeInTheDocument();
    // The core honesty guarantee: mock mode must never read as live Odoo.
    expect(screen.queryByText("Connected to Odoo")).not.toBeInTheDocument();
  });

  it("shows service-unavailable when the API can't be reached", () => {
    render(<DataSourceStatus status="offline" />);
    expect(screen.getByText("Service unavailable")).toBeInTheDocument();
  });

  it("conveys state with a role and text, not color alone", () => {
    render(<DataSourceStatus status="offline" />);
    // role=status is present and carries readable text.
    expect(screen.getByRole("status")).toHaveTextContent("Service unavailable");
  });
});

describe("WorkspaceHeader", () => {
  it("renders the current conversation title and the data-source status", () => {
    render(
      <WorkspaceHeader title="Q2 receivables" status="online" onOpenNav={vi.fn()} />
    );
    expect(screen.getByRole("heading", { name: "Q2 receivables" })).toBeInTheDocument();
    expect(screen.getByText("Demo data")).toBeInTheDocument();
  });

  it("exposes an accessible mobile navigation trigger that fires onOpenNav", () => {
    const onOpenNav = vi.fn();
    render(<WorkspaceHeader title="Chat" status="online" onOpenNav={onOpenNav} />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(onOpenNav).toHaveBeenCalledTimes(1);
  });
});

describe("ConversationSidebar — history + actions", () => {
  const conversations = [
    { id: "c1", title: "First chat", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "c2", title: "Second chat", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
  ];

  it("shows the tool-capability count once known", () => {
    render(<ConversationSidebar {...sidebarProps} toolCount={14} />);
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("tools available")).toBeInTheDocument();
  });

  it("renders each conversation and selects on click", () => {
    const onSelectConversation = vi.fn();
    render(
      <ConversationSidebar
        {...sidebarProps}
        conversations={conversations}
        activeId="c1"
        onSelectConversation={onSelectConversation}
      />
    );
    expect(screen.getByText("First chat")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Second chat"));
    expect(onSelectConversation).toHaveBeenCalledWith("c2");
  });

  it("marks the active conversation with aria-current, not color alone", () => {
    render(
      <ConversationSidebar {...sidebarProps} conversations={conversations} activeId="c1" />
    );
    expect(screen.getByText("First chat")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Second chat")).not.toHaveAttribute("aria-current");
  });

  it("exposes accessible labels for the rename/delete icon buttons", () => {
    render(
      <ConversationSidebar {...sidebarProps} conversations={conversations} activeId="c1" />
    );
    expect(screen.getByLabelText("Rename First chat")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete First chat")).toBeInTheDocument();
  });

  it("fires onNewConversation from the New conversation action", () => {
    const onNewConversation = vi.fn();
    render(<ConversationSidebar {...sidebarProps} onNewConversation={onNewConversation} />);
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });

  it("does NOT duplicate quick-question shortcuts in the sidebar (AG5A)", () => {
    render(<ConversationSidebar {...sidebarProps} conversations={conversations} activeId="c1" />);
    expect(screen.queryByText(/Business Alerts/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Quick Questions/)).not.toBeInTheDocument();
  });
});

describe("ConversationSidebar — collapse", () => {
  it("offers a labelled collapse toggle that reports expanded state and fires", () => {
    const onToggleCollapse = vi.fn();
    render(
      <ConversationSidebar
        {...sidebarProps}
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
      />
    );
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("hides labels and history when collapsed", () => {
    render(
      <ConversationSidebar
        {...sidebarProps}
        conversations={[
          { id: "c1", title: "First chat", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        ]}
        activeId="c1"
        collapsed
        onToggleCollapse={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.queryByText("First chat")).not.toBeInTheDocument();
    expect(screen.queryByText("tools available")).not.toBeInTheDocument();
  });

  it("shows a Close control (not a collapse toggle) in drawer mode", () => {
    const onClose = vi.fn();
    render(<ConversationSidebar {...sidebarProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
  });
});
