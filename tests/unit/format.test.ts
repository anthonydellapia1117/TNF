import { describe, expect, it } from "vitest";
import { etDateOf, etWallClockToUtcISO, nineAmETUtcISO } from "@/lib/format";

describe("ET wall-clock → UTC (scheduled reveal default)", () => {
  it("9 AM ET is 13:00Z during daylight time (season opener)", () => {
    expect(nineAmETUtcISO("2026-09-09")).toBe("2026-09-09T13:00:00.000Z");
  });

  it("9 AM ET is 14:00Z during standard time (Thanksgiving)", () => {
    expect(nineAmETUtcISO("2026-11-26")).toBe("2026-11-26T14:00:00.000Z");
  });

  it("handles the DST boundary week on both sides (DST ends Nov 1 2026)", () => {
    expect(nineAmETUtcISO("2026-10-31")).toBe("2026-10-31T13:00:00.000Z");
    expect(nineAmETUtcISO("2026-11-01")).toBe("2026-11-01T14:00:00.000Z");
  });

  it("converts arbitrary wall-clock times", () => {
    expect(etWallClockToUtcISO("2026-12-25", "16:30")).toBe(
      "2026-12-25T21:30:00.000Z",
    );
    expect(etWallClockToUtcISO("2026-09-10", "20:15")).toBe(
      "2026-09-11T00:15:00.000Z",
    );
  });

  it("round-trips through etDateOf", () => {
    // A late ET kickoff is already the next day in UTC — the ET date is what
    // the reveal default keys on.
    const utc = etWallClockToUtcISO("2026-09-10", "20:15");
    expect(utc.startsWith("2026-09-11")).toBe(true);
    expect(etDateOf(utc)).toBe("2026-09-10");
  });
});
