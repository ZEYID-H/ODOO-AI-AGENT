import { afterEach, describe, expect, it, vi } from "vitest";

// server-only's real implementation unconditionally throws — it relies on
// Next's bundler to statically strip/detect it, which Vitest doesn't do.
// Stubbing it is the standard way to unit-test a server-only module; the
// actual server/client boundary is enforced at `npm run build` time.
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { requireSession } from "../lib/session-guard";

const mockedAuth = vi.mocked(auth);
const mockedRedirect = vi.mocked(redirect);

afterEach(() => {
  vi.clearAllMocks();
});

describe("requireSession — the actual server-side /dashboard guard", () => {
  it("does NOT redirect when a valid session exists", async () => {
    const fakeSession = { user: { name: "Personal Access" }, expires: "2099-01-01" };
    mockedAuth.mockResolvedValue(fakeSession as never);

    const session = await requireSession();

    expect(mockedRedirect).not.toHaveBeenCalled();
    expect(session).toEqual(fakeSession);
  });

  it("redirects to /login when there is no session (unauthenticated access blocked)", async () => {
    mockedAuth.mockResolvedValue(null);

    await requireSession();

    expect(mockedRedirect).toHaveBeenCalledWith("/login");
    expect(mockedRedirect).toHaveBeenCalledTimes(1);
  });
});
