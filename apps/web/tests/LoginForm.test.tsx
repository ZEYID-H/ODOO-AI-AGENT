// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/app/actions/auth", () => ({
  loginAction: vi.fn(),
}));

import { loginAction } from "@/app/actions/auth";
import LoginForm from "../components/LoginForm";

const mockedLoginAction = vi.mocked(loginAction);

afterEach(() => {
  vi.clearAllMocks();
});

describe("LoginForm — login page renders and handles credentials safely", () => {
  it("renders a password field and a submit button", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Access Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("password input has type=password (never rendered as plain text)", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Access Password")).toHaveAttribute("type", "password");
  });

  it("shows a clear, safe error message when credentials are invalid, without leaking why", async () => {
    mockedLoginAction.mockResolvedValue({ error: "Invalid password. Please try again." });

    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Access Password"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid password. Please try again.");
    // Never echoes the submitted password or hints at what's misconfigured.
    expect(alert.textContent).not.toContain("wrong-password");
  });

  it("shows a pending state while the login request is in flight", async () => {
    let resolveLogin!: (v: Awaited<ReturnType<typeof loginAction>>) => void;
    mockedLoginAction.mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      })
    );

    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Access Password"), {
      target: { value: "something" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("button", { name: /signing in/i })).toBeDisabled();

    resolveLogin({});
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign in/i })).not.toBeDisabled()
    );
  });
});
