// Words for numbers and dates, the email way. No dollar sign anywhere: an
// amount is written 1,500. Dates are absolute ("Tue Nov 24, 2026"), never
// relative, always in the pool's time zone.

export const POOL_TZ = "America/New_York";

/** 50000 -> "500", 150000 -> "1,500". Whole dollars only; cents refuse. */
export function amount(cents: number): string {
  if (!Number.isInteger(cents) || cents % 100 !== 0) {
    throw new Error(`amount: ${cents} cents is not a whole-dollar amount; the pool has none`);
  }
  return (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function parts(d: Date, opts: Intl.DateTimeFormatOptions, tz = POOL_TZ) {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
}

/** A calendar date (YYYY-MM-DD) as noon UTC, so no time zone moves its day. */
export function civil(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`civil: "${ymd}" is not YYYY-MM-DD`);
  return new Date(`${ymd}T12:00:00Z`);
}

/** The pool-local calendar date of an instant, YYYY-MM-DD. */
export function localYmd(iso: string, tz = POOL_TZ): string {
  const p = parts(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit" }, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "Tue Nov 24, 2026" from YYYY-MM-DD. */
export function longDate(ymd: string): string {
  const p = parts(civil(ymd), { weekday: "short", month: "short", day: "numeric", year: "numeric" }, "UTC");
  return `${p.weekday} ${p.month} ${p.day}, ${p.year}`;
}

/** "Oct 7" from YYYY-MM-DD. */
export function monthDay(ymd: string): string {
  const p = parts(civil(ymd), { month: "short", day: "numeric" }, "UTC");
  return `${p.month} ${p.day}`;
}

/** "Wed Nov 25" from YYYY-MM-DD. */
export function shortDate(ymd: string): string {
  const p = parts(civil(ymd), { weekday: "short", month: "short", day: "numeric" }, "UTC");
  return `${p.weekday} ${p.month} ${p.day}`;
}

/** "Wed 11/25" from YYYY-MM-DD: the sweep replies' own style. */
export function weekdaySlash(ymd: string): string {
  const p = parts(civil(ymd), { weekday: "short", month: "numeric", day: "numeric" }, "UTC");
  return `${p.weekday} ${p.month}/${p.day}`;
}

/** "8:00 PM" for an instant, in the pool's zone. */
export function clock(iso: string, tz = POOL_TZ): string {
  const p = parts(new Date(iso), { hour: "numeric", minute: "2-digit", hour12: true }, tz);
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** "8 AM" from "08:00": the reveal time, written the way people say it. */
export function hourLabel(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`hourLabel: "${hhmm}" is not HH:MM`);
  const h = Number(m[1]);
  const min = m[2];
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ap = h < 12 ? "AM" : "PM";
  return min === "00" ? `${h12} ${ap}` : `${h12}:${min} ${ap}`;
}

/** "Green Bay Packers" -> "Packers". Every NFL nickname is the last word. */
export function teamShort(name: string): string {
  const words = name.trim().split(/\s+/);
  return words[words.length - 1] ?? name;
}

/** "5", "3 and 5", "3, 5 and 9". */
export function andList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The copy rule: an em dash or an en dash becomes a hyphen. */
export function hyphenate(s: string): string {
  return s.replace(/[–—]/g, "-");
}
