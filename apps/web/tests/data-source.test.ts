import { describe, expect, it } from "vitest";
import { resolveDataSource } from "../lib/data-source";

describe("resolveDataSource — honest by construction", () => {
  it("reports connecting while the health check is pending, regardless of backend", () => {
    expect(resolveDataSource("checking", "mock")).toBe("connecting");
    expect(resolveDataSource("checking", "odoo")).toBe("connecting");
  });

  it("reports api-unavailable when the backend can't be reached", () => {
    expect(resolveDataSource("offline", "mock")).toBe("api-unavailable");
    expect(resolveDataSource("offline", "odoo")).toBe("api-unavailable");
  });

  it("reports demo when online on the mock backend", () => {
    expect(resolveDataSource("online", "mock")).toBe("demo");
  });

  it("reports odoo only when online AND wired to a real instance", () => {
    expect(resolveDataSource("online", "odoo")).toBe("odoo");
  });

  it("never lets mock data masquerade as a live Odoo connection", () => {
    expect(resolveDataSource("online", "mock")).not.toBe("odoo");
    expect(resolveDataSource("checking", "mock")).not.toBe("odoo");
    expect(resolveDataSource("offline", "mock")).not.toBe("odoo");
  });
});
