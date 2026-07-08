import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api-token", () => ({ mintApiToken: vi.fn() }));

import { auth } from "@/auth";
import { mintApiToken } from "@/lib/api-token";
import { getApiToken } from "../app/actions/api-token";

const mockedAuth = vi.mocked(auth);
const mockedMint = vi.mocked(mintApiToken);

afterEach(() => {
  vi.clearAllMocks();
});

describe("getApiToken (Phase 10, owner-only since Delivery D1)", () => {
  it("mints a token asserting the session's own user id — never a client-supplied one", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "personal-user", name: "admin", role: "OWNER" },
      expires: "2099-01-01",
    } as never);
    mockedMint.mockResolvedValue("signed.jwt.token");

    const token = await getApiToken();

    expect(token).toBe("signed.jwt.token");
    expect(mockedMint).toHaveBeenCalledWith("personal-user");
    expect(mockedMint).toHaveBeenCalledTimes(1);
  });

  it("throws rather than minting anything when there is no session", async () => {
    mockedAuth.mockResolvedValue(null);

    await expect(getApiToken()).rejects.toThrow(/not authenticated/i);
    expect(mockedMint).not.toHaveBeenCalled();
  });

  it("throws when the session has no user id (matches app/actions/conversations.ts's own guard)", async () => {
    mockedAuth.mockResolvedValue({ user: {}, expires: "2099-01-01" } as never);

    await expect(getApiToken()).rejects.toThrow(/not authenticated/i);
    expect(mockedMint).not.toHaveBeenCalled();
  });

  it("refuses a DRIVER session — drivers can never reach the AI endpoints (D1)", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "driver-1", name: "driver_ahmed", role: "DRIVER" },
      expires: "2099-01-01",
    } as never);

    await expect(getApiToken()).rejects.toThrow(/not authorized/i);
    expect(mockedMint).not.toHaveBeenCalled();
  });

  it("refuses a session with no role claim (pre-D1 cookie) — fails closed", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "personal-user", name: "admin" },
      expires: "2099-01-01",
    } as never);

    await expect(getApiToken()).rejects.toThrow(/not authorized/i);
    expect(mockedMint).not.toHaveBeenCalled();
  });
});
