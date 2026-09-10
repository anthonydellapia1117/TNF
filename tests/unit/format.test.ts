import { describe, expect, it } from "vitest";
import { collectorLabel, etDateOf, etWallClockToUtcISO, revealSlotUtcISO } from "@/lib/format";

describe("ET wall-clock → UTC (scheduled reveal default)", () => {
  it("the 8 AM ET reveal slot is 12:00Z during daylight time (season opener)", () => {
    expect(revealSlotUtcISO("2026-09-09")).toBe("2026-09-09T12:00:00.000Z");
  });

  it("the 8 AM ET reveal slot is 13:00Z during standard time (Thanksgiving)", () => {
    expect(revealSlotUtcISO("2026-11-26")).toBe("2026-11-26T13:00:00.000Z");
  });

  it("handles the DST boundary week on both sides (DST ends Nov 1 2026)", () => {
    expect(revealSlotUtcISO("2026-10-31")).toBe("2026-10-31T12:00:00.000Z");
    expect(revealSlotUtcISO("2026-11-01")).toBe("2026-11-01T13:00:00.000Z");
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

/**
 * One rule read in three places - the queue summary, the ledger row and the
 * xlsx export - and three copies of it would drift. AVD is Anthony, and
 * migration 31 reads AVD and null identically when it decides the move, so a
 * surface that printed "AVD" would dress the default up as the exception.
 */
describe("collectorLabel", () => {
  it("names an owner who is holding the cash", () => {
    expect(collectorLabel("JPOD")).toBe("JPOD");
  });

  it("says nothing when the money reached Anthony", () => {
    expect(collectorLabel(null)).toBeNull();
    expect(collectorLabel(undefined)).toBeNull();
    expect(collectorLabel("")).toBeNull();
  });

  it("treats AVD as Anthony, the same way the RPC does", () => {
    expect(collectorLabel("AVD")).toBeNull();
  });

  it("does not trust whitespace to be absence", () => {
    expect(collectorLabel("  ")).toBeNull();
    expect(collectorLabel(" JPOD ")).toBe("JPOD");
  });
});
