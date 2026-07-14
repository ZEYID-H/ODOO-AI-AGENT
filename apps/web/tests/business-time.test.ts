import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertValidTimeZone,
  getBusinessTimeZone,
  businessTimeZoneLabel,
  businessDayRangeUtc,
} from "../lib/business-time";

const QATAR = "Asia/Qatar"; // UTC+3, no DST → local midnight = 21:00 UTC prev day
const iso = (d: Date) => d.toISOString();

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("businessDayRangeUtc — Asia/Qatar local-day boundaries", () => {
  it("maps a mid-day Qatar instant to [prev-day 21:00Z, this-day 21:00Z)", () => {
    // 2026-07-11T09:00Z = 12:00 Qatar on Jul 11.
    const { startUtc, endUtc } = businessDayRangeUtc(new Date("2026-07-11T09:00:00Z"), QATAR);
    expect(iso(startUtc)).toBe("2026-07-10T21:00:00.000Z");
    expect(iso(endUtc)).toBe("2026-07-11T21:00:00.000Z");
  });

  it("uses the Qatar calendar date, not UTC's, when the two differ near midnight", () => {
    // 22:00Z on Jul 10 is already 01:00 Jul 11 in Qatar. The day must be
    // Jul 11 (start 2026-07-10T21:00Z), not UTC's Jul 10.
    const { startUtc } = businessDayRangeUtc(new Date("2026-07-10T22:00:00Z"), QATAR);
    expect(iso(startUtc)).toBe("2026-07-10T21:00:00.000Z");
  });

  it("classifies an upload shortly AFTER Qatar midnight as the new day", () => {
    // 00:05 Qatar Jul 11 == 2026-07-10T21:05Z.
    const upload = new Date("2026-07-10T21:05:00Z");
    const jul11 = businessDayRangeUtc(new Date("2026-07-11T09:00:00Z"), QATAR);
    expect(upload >= jul11.startUtc && upload < jul11.endUtc).toBe(true);

    const jul10 = businessDayRangeUtc(new Date("2026-07-10T09:00:00Z"), QATAR);
    expect(upload >= jul10.startUtc && upload < jul10.endUtc).toBe(false);
  });

  it("classifies an upload shortly BEFORE Qatar midnight as the current day", () => {
    // 23:55 Qatar Jul 10 == 2026-07-10T20:55Z.
    const upload = new Date("2026-07-10T20:55:00Z");
    const jul10 = businessDayRangeUtc(new Date("2026-07-10T09:00:00Z"), QATAR);
    expect(upload >= jul10.startUtc && upload < jul10.endUtc).toBe(true);

    const jul11 = businessDayRangeUtc(new Date("2026-07-11T09:00:00Z"), QATAR);
    expect(upload >= jul11.startUtc && upload < jul11.endUtc).toBe(false);
  });

  it("has an EXCLUSIVE end: an instant exactly at endUtc is the next day, not this one", () => {
    const today = businessDayRangeUtc(new Date("2026-07-11T09:00:00Z"), QATAR);
    // Exactly at the boundary is excluded from today...
    expect(today.endUtc < today.endUtc).toBe(false);
    expect(today.endUtc >= today.endUtc && today.endUtc < today.endUtc).toBe(false);
    // ...and is precisely the start of the next day's range.
    const next = businessDayRangeUtc(today.endUtc, QATAR);
    expect(iso(next.startUtc)).toBe(iso(today.endUtc));
  });

  it("rolls over month/year boundaries correctly", () => {
    // 2026-12-31T22:00Z = 01:00 Qatar Jan 1 2027.
    const { startUtc, endUtc } = businessDayRangeUtc(new Date("2026-12-31T22:00:00Z"), QATAR);
    expect(iso(startUtc)).toBe("2026-12-31T21:00:00.000Z"); // Jan 1 2027 midnight Qatar
    expect(iso(endUtc)).toBe("2027-01-01T21:00:00.000Z"); // Jan 2 2027 midnight Qatar
  });

  it("defaults the reference to now and the zone to BUSINESS_TIMEZONE", () => {
    vi.stubEnv("BUSINESS_TIMEZONE", QATAR);
    const now = new Date();
    const { startUtc, endUtc } = businessDayRangeUtc();
    expect(now >= startUtc && now < endUtc).toBe(true);
  });
});

describe("timezone configuration validation — fails clearly", () => {
  it("assertValidTimeZone throws on a non-IANA zone", () => {
    expect(() => assertValidTimeZone("Not/AZone")).toThrow(/Invalid BUSINESS_TIMEZONE/);
    expect(() => assertValidTimeZone("Mars/Phobos")).toThrow(/Invalid BUSINESS_TIMEZONE/);
  });

  it("assertValidTimeZone accepts real zones", () => {
    expect(() => assertValidTimeZone("Asia/Qatar")).not.toThrow();
    expect(() => assertValidTimeZone("America/New_York")).not.toThrow();
    expect(() => assertValidTimeZone("UTC")).not.toThrow();
  });

  it("getBusinessTimeZone throws when unset and when invalid", () => {
    vi.stubEnv("BUSINESS_TIMEZONE", "");
    expect(() => getBusinessTimeZone()).toThrow(/not configured/i);

    vi.stubEnv("BUSINESS_TIMEZONE", "Bogus/Zone");
    expect(() => getBusinessTimeZone()).toThrow(/Invalid BUSINESS_TIMEZONE/);
  });

  it("getBusinessTimeZone returns the configured zone", () => {
    vi.stubEnv("BUSINESS_TIMEZONE", QATAR);
    expect(getBusinessTimeZone()).toBe(QATAR);
  });
});

describe("businessTimeZoneLabel — configurable, never hardcoded", () => {
  it("derives a friendly label from the zone name", () => {
    expect(businessTimeZoneLabel("Asia/Qatar")).toBe("Qatar");
    expect(businessTimeZoneLabel("America/New_York")).toBe("New York");
    expect(businessTimeZoneLabel("UTC")).toBe("UTC");
  });
});
