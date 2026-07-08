import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import { attemptLogin, verifyCredentials } from "../lib/auth-credentials";
import { resetLoginRateLimit } from "../lib/login-rate-limit";

// Real DB-backed tests against prisma/test.db (same pattern as
// conversations.test.ts): credentials now live in the User table, so
// mocking prisma here would test the mock, not the login path. Unique
// usernames per run so an interrupted prior run can't collide.
const RUN = Date.now();
const OWNER_NAME = `test-admin-${RUN}`;
const DRIVER_NAME = `test-driver-${RUN}`;
const UNSEEDED_NAME = `test-unseeded-${RUN}`;
const BAD_ROLE_NAME = `test-badrole-${RUN}`;

const OWNER_PASSWORD = "owner-pass-correct-horse";
const DRIVER_PASSWORD = "driver-pass-battery-staple";

beforeEach(() => {
  resetLoginRateLimit();
});

// One hashing round for the whole suite — bcrypt is deliberately slow.
const setup = (async () => {
  await prisma.user.createMany({
    data: [
      {
        username: OWNER_NAME,
        passwordHash: await hash(OWNER_PASSWORD, 10),
        role: "OWNER",
      },
      {
        username: DRIVER_NAME,
        passwordHash: await hash(DRIVER_PASSWORD, 10),
        role: "DRIVER",
      },
      // What the D1 migration backfill produces: an empty hash. Must never
      // be loggable, with any input.
      { username: UNSEEDED_NAME, passwordHash: "", role: "OWNER" },
      // Only reachable via manual DB edits, but must still fail closed.
      {
        username: BAD_ROLE_NAME,
        passwordHash: await hash(OWNER_PASSWORD, 10),
        role: "SUPERADMIN",
      },
    ],
  });
})();

afterAll(async () => {
  await setup;
  await prisma.user.deleteMany({
    where: { username: { in: [OWNER_NAME, DRIVER_NAME, UNSEEDED_NAME, BAD_ROLE_NAME] } },
  });
});

describe("verifyCredentials (Delivery D1 — DB-backed username/password)", () => {
  it("returns the user with their role on correct credentials", async () => {
    await setup;
    const owner = await verifyCredentials(OWNER_NAME, OWNER_PASSWORD);
    expect(owner).toMatchObject({ name: OWNER_NAME, role: "OWNER" });
    expect(owner?.id).toBeTruthy();

    const driver = await verifyCredentials(DRIVER_NAME, DRIVER_PASSWORD);
    expect(driver).toMatchObject({ name: DRIVER_NAME, role: "DRIVER" });
  });

  it("returns null on a wrong password", async () => {
    await setup;
    expect(await verifyCredentials(OWNER_NAME, "wrong-password")).toBeNull();
  });

  it("returns null for an unknown username", async () => {
    await setup;
    expect(await verifyCredentials(`no-such-user-${RUN}`, OWNER_PASSWORD)).toBeNull();
  });

  it("cannot log into a migration-backfilled row (empty hash), with any input", async () => {
    await setup;
    expect(await verifyCredentials(UNSEEDED_NAME, "")).toBeNull();
    expect(await verifyCredentials(UNSEEDED_NAME, "anything")).toBeNull();
  });

  it("rejects a row whose role isn't OWNER or DRIVER even with the right password", async () => {
    await setup;
    expect(await verifyCredentials(BAD_ROLE_NAME, OWNER_PASSWORD)).toBeNull();
  });

  it("rejects empty and non-string input safely (no throw)", async () => {
    await setup;
    expect(await verifyCredentials("", OWNER_PASSWORD)).toBeNull();
    expect(await verifyCredentials(OWNER_NAME, "")).toBeNull();
    expect(await verifyCredentials(undefined, undefined)).toBeNull();
    expect(await verifyCredentials(null, 12345)).toBeNull();
    expect(await verifyCredentials({ username: OWNER_NAME }, { password: "x" })).toBeNull();
  });
});

// This is what auth.ts's authorize() actually calls — the real chokepoint
// for every sign-in attempt, including Auth.js's raw
// /api/auth/callback/credentials route (see auth.ts's Phase 9 audit
// comment for why the check can't live only in the login Server Action).
describe("attemptLogin — per-username brute-force protection", () => {
  it("succeeds on correct credentials", async () => {
    await setup;
    const user = await attemptLogin(OWNER_NAME, OWNER_PASSWORD);
    expect(user).toMatchObject({ name: OWNER_NAME, role: "OWNER" });
  });

  it("locks an account after 5 wrong passwords — even the correct one is then refused", async () => {
    await setup;
    for (let i = 0; i < 5; i++) {
      expect(await attemptLogin(OWNER_NAME, "wrong")).toBeNull();
    }
    expect(await attemptLogin(OWNER_NAME, OWNER_PASSWORD)).toBeNull();
  });

  it("does NOT lock other accounts: one driver's failures never block the admin", async () => {
    await setup;
    for (let i = 0; i < 5; i++) {
      expect(await attemptLogin(DRIVER_NAME, "wrong")).toBeNull();
    }
    // The hammered account is locked…
    expect(await attemptLogin(DRIVER_NAME, DRIVER_PASSWORD)).toBeNull();
    // …but a different account is completely unaffected.
    expect(await attemptLogin(OWNER_NAME, OWNER_PASSWORD)).toMatchObject({
      role: "OWNER",
    });
  });

  it("resets the counter on a successful login", async () => {
    await setup;
    for (let i = 0; i < 4; i++) {
      expect(await attemptLogin(OWNER_NAME, "wrong")).toBeNull();
    }
    expect(await attemptLogin(OWNER_NAME, OWNER_PASSWORD)).not.toBeNull();
    // The successful login cleared the 4 failures — a fresh mistake doesn't lock.
    expect(await attemptLogin(OWNER_NAME, "wrong")).toBeNull();
    expect(await attemptLogin(OWNER_NAME, OWNER_PASSWORD)).not.toBeNull();
  });
});
