import { afterEach, describe, expect, it, vi } from "vitest";

// server-only's real implementation unconditionally throws — it relies on
// Next's bundler to statically strip/detect it, which Vitest doesn't do.
// Stubbing it is the standard way to unit-test a server-only module; the
// actual server/client boundary is enforced at `npm run build` time.
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
// Next's real redirect() throws (control flow never continues past it).
// The mock replicates that — requireRole's logic after a redirect must be
// unreachable, exactly as in production.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { requireSession, requireRole } from "../lib/session-guard";

const mockedAuth = vi.mocked(auth);
const mockedRedirect = vi.mocked(redirect);

function sessionWith(role?: "OWNER" | "DRIVER") {
  return {
    user: { id: "user-1", name: "Someone", ...(role ? { role } : {}) },
    expires: "2099-01-01",
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("requireSession — the actual server-side guard", () => {
  it("does NOT redirect when a valid session exists", async () => {
    const fakeSession = sessionWith("OWNER");
    mockedAuth.mockResolvedValue(fakeSession as never);

    const session = await requireSession();

    expect(mockedRedirect).not.toHaveBeenCalled();
    expect(session).toEqual(fakeSession);
  });

  it("redirects to /login when there is no session (unauthenticated access blocked)", async () => {
    mockedAuth.mockResolvedValue(null);

    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(mockedRedirect).toHaveBeenCalledWith("/login");
    expect(mockedRedirect).toHaveBeenCalledTimes(1);
  });
});

describe("requireRole (Delivery D1) — role-gated variant", () => {
  it("returns the session when the role matches", async () => {
    mockedAuth.mockResolvedValue(sessionWith("OWNER") as never);

    const session = await requireRole("OWNER");

    expect(mockedRedirect).not.toHaveBeenCalled();
    expect(session.user.role).toBe("OWNER");
  });

  it("sends a DRIVER asking for an OWNER page to /driver — never renders it", async () => {
    mockedAuth.mockResolvedValue(sessionWith("DRIVER") as never);

    await expect(requireRole("OWNER")).rejects.toThrow("NEXT_REDIRECT:/driver");
    expect(mockedRedirect).toHaveBeenCalledWith("/driver");
  });

  it("sends an OWNER asking for a DRIVER page to /dashboard", async () => {
    mockedAuth.mockResolvedValue(sessionWith("OWNER") as never);

    await expect(requireRole("DRIVER")).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(mockedRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("fails closed to /login for a session with no role claim (pre-D1 cookie)", async () => {
    mockedAuth.mockResolvedValue(sessionWith(undefined) as never);

    await expect(requireRole("OWNER")).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mockedRedirect).toHaveBeenCalledWith("/login");
  });

  it("redirects unauthenticated requests to /login before any role logic runs", async () => {
    mockedAuth.mockResolvedValue(null);

    await expect(requireRole("DRIVER")).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mockedRedirect).toHaveBeenCalledWith("/login");
    expect(mockedRedirect).toHaveBeenCalledTimes(1);
  });
});
