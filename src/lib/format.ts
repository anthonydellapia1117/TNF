// Formatting helpers. All dates render in America/New_York (spec config).

const ET = "America/New_York";

/** Whole-dollar money: $750, $1,500, $44,250. Cents shown only when present. */
export function fmtUsd(cents: number): string {
  const dollars = cents / 100;
  const hasCents = cents % 100 !== 0;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  });
}

/** "Thu Nov 26" */
export function fmtDateET(iso: string | null): string {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: ET,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Wednesday, September 9" */
export function fmtDateLongET(iso: string | null): string {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: ET,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** "Thu Nov 26, 4:30 PM ET" for any instant. */
export function fmtDateTimeET(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", {
    timeZone: ET,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date}, ${time} ET`;
}

/** "Thu Nov 26, 4:30 PM ET", or "Date TBD" for an unscheduled game. */
export function fmtKickoffET(iso: string | null): string {
  if (!iso) return "Date TBD";
  return fmtDateTimeET(iso);
}

/** The ET calendar date (YYYY-MM-DD) an instant falls on. */
export function etDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: ET });
}

/**
 * An ET wall-clock date + time as a UTC ISO instant, DST-proof: Eastern is
 * either -04:00 or -05:00, so try both and keep the one that round-trips to
 * the same wall clock in America/New_York. (The ambiguous 1–2 AM fall-back
 * hour resolves to EDT; no pool event lands there.)
 */
export function etWallClockToUtcISO(ymd: string, hm: string): string {
  for (const offset of ["-04:00", "-05:00"]) {
    const d = new Date(`${ymd}T${hm}:00${offset}`);
    const back = d.toLocaleString("sv-SE", { timeZone: ET }).slice(0, 16);
    if (back === `${ymd} ${hm}`) return d.toISOString();
  }
  return new Date(`${ymd}T${hm}:00-05:00`).toISOString();
}

/**
 * The pool's standing reveal slot. One value, used everywhere: the weekly
 * draw schedules it, the per-game dialog defaults to it, and the public
 * countdown promises it. Changing it here changes all three together.
 */
export const REVEAL_TIME_ET = "08:00";

/** The reveal slot on the given ET date, as a UTC ISO instant. */
export function revealSlotUtcISO(ymd: string): string {
  return etWallClockToUtcISO(ymd, REVEAL_TIME_ET);
}

/** "Sep 4, 2026" for dates stored as YYYY-MM-DD. */
export function fmtDateOnly(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
