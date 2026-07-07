// server-only's real implementation unconditionally throws — it relies on
// Next's bundler to statically strip/detect it, which Vitest doesn't do.
// Stubbing it is the standard way to unit-test a server-only module; the
// actual server/client boundary is enforced at `npm run build` time (see
// session-guard.test.ts for the same pattern).
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { jwtVerify } from "jose";
import { mintApiToken } from "../lib/api-token";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllEnvs();
});

describe("mintApiToken (Phase 10 trust boundary)", () => {
  it("signs a token verifiable with the same secret, asserting the given user id as `sub`", async () => {
    vi.stubEnv("API_AUTH_SECRET", "test-secret-at-least-32-bytes-long!!");
    const token = await mintApiToken("personal-user");

    const { payload, protectedHeader } = await jwtVerify(
      token,
      new TextEncoder().encode("test-secret-at-least-32-bytes-long!!"),
      { issuer: "odoo-ai-agent-web", audience: "odoo-ai-agent-api" }
    );

    expect(protectedHeader.alg).toBe("HS256");
    expect(payload.sub).toBe("personal-user");
    expect(payload.iss).toBe("odoo-ai-agent-web");
    expect(payload.aud).toBe("odoo-ai-agent-api");
    expect(payload.iat).toBeTypeOf("number");
    expect(payload.exp).toBeTypeOf("number");
  });

  it("mints a token that expires in the near future, not a long-lived one", async () => {
    vi.stubEnv("API_AUTH_SECRET", "test-secret-at-least-32-bytes-long!!");
    const token = await mintApiToken("personal-user");
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode("test-secret-at-least-32-bytes-long!!"),
      { issuer: "odoo-ai-agent-web", audience: "odoo-ai-agent-api" }
    );
    const lifetimeSeconds = (payload.exp as number) - (payload.iat as number);
    // Exactly 5 minutes today; assert "short-lived" (well under an hour)
    // rather than the literal constant, so this doesn't need updating for
    // small tuning changes while still catching "someone accidentally
    // made this a long-lived token" regressions.
    expect(lifetimeSeconds).toBeGreaterThan(0);
    expect(lifetimeSeconds).toBeLessThanOrEqual(600);
  });

  it("rejects verification with the wrong secret (proves it's actually signed, not just encoded)", async () => {
    vi.stubEnv("API_AUTH_SECRET", "test-secret-at-least-32-bytes-long!!");
    const token = await mintApiToken("personal-user");

    await expect(
      jwtVerify(token, new TextEncoder().encode("a-totally-different-secret-value!!"), {
        issuer: "odoo-ai-agent-web",
        audience: "odoo-ai-agent-api",
      })
    ).rejects.toThrow();
  });

  it("fails closed when API_AUTH_SECRET is not configured, rather than signing with an empty key", async () => {
    vi.stubEnv("API_AUTH_SECRET", "");
    delete process.env.API_AUTH_SECRET;
    await expect(mintApiToken("personal-user")).rejects.toThrow(/API_AUTH_SECRET/);
  });
});
