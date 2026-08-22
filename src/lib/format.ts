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

/** "Thu Nov 26, 4:30 PM ET" */
export function fmtKickoffET(iso: string | null): string {
  if (!iso) return "Date TBD";
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
