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

import { getHealth, listTools, chat, ApiError } from "@/lib/api";
import DashboardPage from "../app/dashboard/page";

const mockedGetHealth = vi.mocked(getHealth);
const mockedListTools = vi.mocked(listTools);
const mockedChat = vi.mocked(chat);

function setupHealthyBackend() {
  mockedGetHealth.mockResolvedValue({ status: "ok", service: "odoo-bi-api" });
  mockedListTools.mockResolvedValue({ count: 14, tools: ["get_business_alerts"] });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DashboardPage — load", () => {
  it("shows the empty state with quick actions once the backend is reachable", async () => {
    setupHealthyBackend();
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText(/Ask a business question, or try one of these/)).toBeInTheDocument();
  });
});

describe("DashboardPage — chat submit", () => {
  it("shows a loading state and renders the answer once chat resolves", async () => {
    setupHealthyBackend();
    let resolveChat!: (v: Awaited<ReturnType<typeof chat>>) => void;
    mockedChat.mockReturnValue(
      new Promise((resolve) => {
        resolveChat = resolve;
      })
    );

    render(<DashboardPage />);
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
    render(<DashboardPage />);
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

    render(<DashboardPage />);
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

    render(<DashboardPage />);
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

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText("API Connected")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Ask a business question..."), {
      target: { value: "show business alerts" },
    });
    fireEvent.click(screen.getByText("↑"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);
  });
});
