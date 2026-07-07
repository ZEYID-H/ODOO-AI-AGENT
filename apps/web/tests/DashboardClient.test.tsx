// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("@/lib/api", () => {
  class ApiError extends Error {}
  return {
    getHealth: vi.fn(),
    listTools: vi.fn(),
    chat: vi.fn(),
    ApiError,
  };
});

// DashboardClient renders Sidebar, which imports logoutAction — pulling in
// the real auth.ts -> next-auth module graph. These tests only exercise the
// chat UI, not Auth.js itself (that's covered by session-guard.test.ts and
// the live end-to-end auth flow), so it's mocked out here.
vi.mock("@/app/actions/auth", () => ({
  loginAction: vi.fn(),
  logoutAction: vi.fn(),
}));

// Server Actions backing conversation persistence — mocked so these tests
// exercise DashboardClient's own wiring, not Prisma/DB behavior (that's
// covered end-to-end by tests/conversations.test.ts).
vi.mock("@/app/actions/conversations", () => ({
  createConversation: vi.fn(),
  loadConversation: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  appendMessage: vi.fn(),
}));

import { getHealth, listTools, chat, ApiError } from "@/lib/api";
import {
  createConversation,
  loadConversation,
  renameConversation,
  deleteConversation,
  appendMessage,
} from "@/app/actions/conversations";
import DashboardClient from "../components/DashboardClient";

const mockedGetHealth = vi.mocked(getHealth);
const mockedListTools = vi.mocked(listTools);
const mockedChat = vi.mocked(chat);
const mockedCreateConversation = vi.mocked(createConversation);
const mockedLoadConversation = vi.mocked(loadConversation);
const mockedRenameConversation = vi.mocked(renameConversation);
const mockedDeleteConversation = vi.mocked(deleteConversation);
const mockedAppendMessage = vi.mocked(appendMessage);

function setupHealthyBackend() {
  mockedGetHealth.mockResolvedValue({ status: "ok", service: "odoo-bi-api" });
  mockedListTools.mockResolvedValue({ count: 14, tools: ["get_business_alerts"] });
}

const conv1 = { id: "conv-1", title: "First chat", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const conv2 = { id: "conv-2", title: "Older chat", createdAt: "2025-12-01T00:00:00.000Z", updatedAt: "2025-12-01T00:00:00.000Z" };

function renderDashboard(overrides?: {
  initialConversations?: typeof conv1[];
  initialActiveId?: string;
  initialMessages?: { id: string; role: "user" | "assistant"; content: string; timestamp: string }[];
}) {
  return render(
    <DashboardClient
      initialConversations={overrides?.initialConversations ?? [conv1]}
      initialActiveId={overrides?.initialActiveId ?? conv1.id}
      initialMessages={overrides?.initialMessages ?? []}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DashboardClient — load", () => {
  it("shows the empty state with quick actions once the backend is reachable", async () => {
    setupHealthyBackend();
    renderDashboard();
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText(/Ask a business question, or try one of these/)).toBeInTheDocument();
  });

  it("renders initial messages loaded from the database instead of the empty state", async () => {
    setupHealthyBackend();
    renderDashboard({
      initialMessages: [
        { id: "m1", role: "user", content: "how much does Apple Mart owe?", timestamp: "2026-01-01T00:00:00.000Z" },
        { id: "m2", role: "assistant", content: "QAR 33,574.50", timestamp: "2026-01-01T00:00:01.000Z" },
      ],
    });
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());
    expect(screen.getByText("how much does Apple Mart owe?")).toBeInTheDocument();
    expect(screen.getByText("QAR 33,574.50")).toBeInTheDocument();
  });
});

describe("DashboardClient — chat submit", () => {
  it("exposes an accessible name for the send button and question input (Phase 9 audit fix)", async () => {
    setupHealthyBackend();
    renderDashboard();
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());
    expect(screen.getByLabelText("Send message")).toBeInTheDocument();
    expect(screen.getByLabelText("Ask a business question")).toBeInTheDocument();
  });

  it("shows a loading state and renders the answer once chat resolves", async () => {
    setupHealthyBackend();
    let resolveChat!: (v: Awaited<ReturnType<typeof chat>>) => void;
    mockedChat.mockReturnValue(
      new Promise((resolve) => {
        resolveChat = resolve;
      })
    );

    renderDashboard();
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Ask a business question..."), {
      target: { value: "show business alerts" },
    });
    fireEvent.click(screen.getByText("↑"));

    expect(await screen.findByText("Thinking…")).toBeInTheDocument();

    resolveChat({
      success: true,
      tool: "get_business_alerts",
      parameters: {},
      result: "## Business Alerts",
    });

    await waitFor(() => expect(screen.queryByText("Thinking…")).not.toBeInTheDocument());
    expect(await screen.findByText(/get_business_alerts/)).toBeInTheDocument();
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });

  it("blocks empty/whitespace-only submissions client-side", async () => {
    setupHealthyBackend();
    renderDashboard();
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Ask a business question..."), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByText("↑"));

    expect(mockedChat).not.toHaveBeenCalled();
  });

  it("does not double-submit when the send button is clicked twice while a request is in flight", async () => {
    setupHealthyBackend();
    let resolveChat!: (v: Awaited<ReturnType<typeof chat>>) => void;
    mockedChat.mockReturnValue(
      new Promise((resolve) => {
        resolveChat = resolve;
      })
    );

    renderDashboard();
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());

    const input = screen.getByPlaceholderText("Ask a business question...");
    fireEvent.change(input, { target: { value: "show business alerts" } });
    const sendButton = screen.getByText("↑");
    fireEvent.click(sendButton);
    // Second click while the first request is still pending.
    fireEvent.click(sendButton);

    expect(mockedChat).toHaveBeenCalledTimes(1);

    resolveChat({ success: true, tool: "get_business_alerts", parameters: {}, result: "ok" });
    await waitFor(() => expect(screen.queryByText("Thinking…")).not.toBeInTheDocument());
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });

  it("renders a styled error bubble (not a raw crash) when the API call throws", async () => {
    setupHealthyBackend();
    mockedChat.mockRejectedValue(new ApiError("Could not reach the API."));

    renderDashboard();
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Ask a business question..."), {
      target: { value: "show business alerts" },
    });
    fireEvent.click(screen.getByText("↑"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not reach the API.");
  });

  it("renders a styled error bubble when the API responds with success: false", async () => {
    setupHealthyBackend();
    mockedChat.mockResolvedValue({
      success: false,
      tool: null,
      parameters: {},
      result: "Sorry, something went wrong while processing that request.",
    });

    renderDashboard();
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Ask a business question..."), {
      target: { value: "show business alerts" },
    });
    fireEvent.click(screen.getByText("↑"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);
  });

  it("persists both the user and assistant turns after a successful round trip", async () => {
    setupHealthyBackend();
    mockedChat.mockResolvedValue({
      success: true,
      tool: "get_business_alerts",
      parameters: {},
      result: "## Business Alerts",
    });
    mockedAppendMessage.mockResolvedValue({
      id: "m1",
      role: "user",
      content: "show business alerts",
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    renderDashboard();
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Ask a business question..."), {
      target: { value: "show business alerts" },
    });
    fireEvent.click(screen.getByText("↑"));

    await waitFor(() => expect(mockedAppendMessage).toHaveBeenCalledTimes(2));
    expect(mockedAppendMessage).toHaveBeenCalledWith(conv1.id, "user", "show business alerts");
    expect(mockedAppendMessage).toHaveBeenCalledWith(conv1.id, "assistant", "## Business Alerts");
  });

  it("does not persist anything when the API call throws", async () => {
    setupHealthyBackend();
    mockedChat.mockRejectedValue(new ApiError("Could not reach the API."));

    renderDashboard();
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Ask a business question..."), {
      target: { value: "show business alerts" },
    });
    fireEvent.click(screen.getByText("↑"));

    await screen.findByRole("alert");
    expect(mockedAppendMessage).not.toHaveBeenCalled();
  });
});

describe("DashboardClient — conversation switching", () => {
  it("creates a new conversation and clears the chat when New Chat is clicked", async () => {
    setupHealthyBackend();
    const newConv = { id: "conv-new", title: "New Chat", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" };
    mockedCreateConversation.mockResolvedValue(newConv);

    renderDashboard({
      initialMessages: [
        { id: "m1", role: "user", content: "how much does Apple Mart owe?", timestamp: "2026-01-01T00:00:00.000Z" },
      ],
    });
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());
    expect(screen.getByText("how much does Apple Mart owe?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ New Chat" }));

    await waitFor(() => expect(mockedCreateConversation).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText("how much does Apple Mart owe?")).not.toBeInTheDocument()
    );
    expect(screen.getByText(/Ask a business question, or try one of these/)).toBeInTheDocument();
  });

  it("loads the selected conversation's messages when switching", async () => {
    setupHealthyBackend();
    mockedLoadConversation.mockResolvedValue({
      ...conv2,
      messages: [
        { id: "m2", role: "assistant", content: "Older conversation content", timestamp: "2025-12-01T00:00:01.000Z" },
      ],
    });

    renderDashboard({ initialConversations: [conv1, conv2] });
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());

    fireEvent.click(screen.getByText(conv2.title));

    await waitFor(() => expect(mockedLoadConversation).toHaveBeenCalledWith(conv2.id));
    expect(await screen.findByText("Older conversation content")).toBeInTheDocument();
  });

  it("renames a conversation via the Server Action", async () => {
    setupHealthyBackend();
    mockedRenameConversation.mockResolvedValue(undefined);

    renderDashboard();
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`Rename ${conv1.title}`));
    const input = screen.getByDisplayValue(conv1.title);
    fireEvent.change(input, { target: { value: "Renamed chat" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mockedRenameConversation).toHaveBeenCalledWith(conv1.id, "Renamed chat")
    );
    expect(await screen.findByText("Renamed chat")).toBeInTheDocument();
  });

  it("deletes a conversation and creates a fresh one when the last conversation is removed", async () => {
    setupHealthyBackend();
    mockedDeleteConversation.mockResolvedValue(undefined);
    const replacement = { id: "conv-replacement", title: "New Chat", createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" };
    mockedCreateConversation.mockResolvedValue(replacement);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDashboard();
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`Delete ${conv1.title}`));

    await waitFor(() => expect(mockedDeleteConversation).toHaveBeenCalledWith(conv1.id));
    await waitFor(() => expect(mockedCreateConversation).toHaveBeenCalledTimes(1));
    confirmSpy.mockRestore();
  });
});
