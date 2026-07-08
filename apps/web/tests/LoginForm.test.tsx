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

function fillAndSubmit(username: string, password: string) {
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: username },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginForm — username/password login (Delivery D1)", () => {
  it("renders username and password fields and a submit button", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("password input has type=password (never rendered as plain text)", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("shows a clear, safe error message when credentials are invalid, without leaking why", async () => {
    mockedLoginAction.mockResolvedValue({
      error: "Invalid username or password. Please try again.",
    });

    render(<LoginForm />);
    fillAndSubmit("driver_ahmed", "wrong-password");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid username or password. Please try again.");
    // Never echoes the submitted credentials or hints at what's misconfigured.
    expect(alert.textContent).not.toContain("wrong-password");
    expect(alert.textContent).not.toContain("driver_ahmed");
  });

  it("shows a pending state while the login request is in flight", async () => {
    let resolveLogin!: (v: Awaited<ReturnType<typeof loginAction>>) => void;
    mockedLoginAction.mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      })
    );

    render(<LoginForm />);
    fillAndSubmit("admin", "something");

    expect(await screen.findByRole("button", { name: /signing in/i })).toBeDisabled();

    resolveLogin({});
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign in/i })).not.toBeDisabled()
    );
  });
});
