/**
 * Business-timezone day boundaries (Delivery D6.1). Single source of truth
 * for "what counts as today" — the D6 dashboard used the container's UTC
 * calendar day, which is wrong for a business running on Asia/Qatar (UTC+3):
 * a delivery uploaded at 01:00 Qatar time (22:00 UTC the previous day)
 * belongs to today, not yesterday.
 *
 * Configuration: BUSINESS_TIMEZONE (a non-secret IANA zone name, e.g.
 * Asia/Qatar). The server is authoritative — a timezone claimed by the
 * browser is never trusted.
 *
 * Implementation: built-in Intl only, no date library. Computing a local
 * day's UTC boundaries is one operation; Intl.DateTimeFormat with a
 * timeZone reliably gives both the wall-clock date for an instant and the
 * zone's offset at an instant, which is all this needs. (Exact for
 * fixed-offset zones like Asia/Qatar; for a DST zone the offset is sampled
 * at the computed boundary, which is correct except within the ~1h DST
 * transition window — acceptable and documented rather than pulling in a
 * full tz library for a single calculation.)
 */

import "server-only";

/** Throws unless `timeZone` is a real IANA zone. Note: Intl silently
 * accepts `undefined` (falls back to the system zone), so callers must
 * guard the missing-config case separately — getBusinessTimeZone does. */
export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new Error(
      `Invalid BUSINESS_TIMEZONE (not a known IANA time zone): ${timeZone}`
    );
  }
}

/** The configured business zone, or a clear error if unset/invalid. */
export function getBusinessTimeZone(): string {
  const tz = process.env.BUSINESS_TIMEZONE;
  if (!tz || tz.trim().length === 0) {
    throw new Error(
      "BUSINESS_TIMEZONE is not configured — set it to an IANA zone (e.g. Asia/Qatar)."
    );
  }
  assertValidTimeZone(tz);
  return tz;
}

/** Human-friendly label from a zone name: "Asia/Qatar" -> "Qatar",
 * "America/New_York" -> "New York". Kept configurable — never hardcoded. */
export function businessTimeZoneLabel(
  timeZone: string = getBusinessTimeZone()
): string {
  const last = timeZone.split("/").pop() ?? timeZone;
  return last.replace(/_/g, " ");
}

/** The wall-clock parts of `instant` as seen in `timeZone`. */
function partsInZone(timeZone: string, instant: Date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Offset (ms) of `timeZone` from UTC at `instant`; positive means ahead
 * of UTC (Asia/Qatar → +10800000). */
function zoneOffsetMs(timeZone: string, instant: Date): number {
  const p = partsInZone(timeZone, instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - instant.getTime();
}

/** UTC instant of local midnight for the given wall-clock date. `month` is
 * 1-based; `day` may overflow (Date.UTC rolls into the next month/year), so
 * `day + 1` cleanly yields the next day's midnight. */
function wallMidnightToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number
): Date {
  const guessMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset = zoneOffsetMs(timeZone, new Date(guessMs));
  return new Date(guessMs - offset);
}

export interface BusinessDayRange {
  /** Inclusive start of the local day, as a UTC instant. */
  startUtc: Date;
  /** Exclusive end (next local midnight), as a UTC instant. */
  endUtc: Date;
}

/**
 * The UTC half-open range [startUtc, endUtc) covering the local calendar
 * day of `reference` in `timeZone`. Use with Prisma as
 * `uploadedAt: { gte: startUtc, lt: endUtc }`. `reference` and `timeZone`
 * are injectable so tests can pin a fixed instant and zone.
 */
export function businessDayRangeUtc(
  reference: Date = new Date(),
  timeZone: string = getBusinessTimeZone()
): BusinessDayRange {
  assertValidTimeZone(timeZone);
  const { year, month, day } = partsInZone(timeZone, reference);
  return {
    startUtc: wallMidnightToUtc(timeZone, year, month, day),
    endUtc: wallMidnightToUtc(timeZone, year, month, day + 1),
  };
}
