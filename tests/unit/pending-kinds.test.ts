import { describe, expect, it } from "vitest";
import {
  DISPATCH,
  STAGEABLE_KINDS,
  isStageableKind,
  outcomeLabel,
} from "@/lib/pending";

// The closed kind list. Before this existed, admin_stage_pending took any
// string, so the sweep could stage "payment_candidate" - a kind that reads
// like it dispatches, that no dispatcher handles - and the row sat green and
// inert. One did, on 2026-09-08, holding $500 that was already in the bank.
describe("STAGEABLE_KINDS", () => {
  it("contains every kind that has a dispatcher", () => {
    for (const kind of Object.keys(DISPATCH)) {
      expect(STAGEABLE_KINDS).toContain(kind);
    }
  });

  it("contains the deliberate no-dispatcher kinds", () => {
    for (const kind of [
      "refund_needed",
      "identity_conflict",
      "non_matching_multiple",
      "unparsed_intake",
      "unclassified_mail",
    ]) {
      expect(STAGEABLE_KINDS).toContain(kind);
    }
  });

  it("rejects payment_candidate, the kind that looked right and did nothing", () => {
    expect(isStageableKind("payment_candidate")).toBe(false);
  });

  it("rejects owner_owes_refund, out of scope since 2026-09-10", () => {
    expect(isStageableKind("owner_owes_refund")).toBe(false);
  });

  it("rejects an unknown kind, a typo and an empty string", () => {
    expect(isStageableKind("paymnet")).toBe(false);
    expect(isStageableKind("")).toBe(false);
    expect(isStageableKind("PAYMENT")).toBe(false);
  });

  it("accepts the kinds the sweep is told to use", () => {
    expect(isStageableKind("payment")).toBe(true);
    expect(isStageableKind("reserve_blocks")).toBe(true);
    expect(isStageableKind("unparsed_intake")).toBe(true);
  });
});

// An approved row that applied nothing must not read like one that worked.
describe("outcomeLabel", () => {
  it("an open row has no outcome", () => {
    expect(outcomeLabel({ resolution: null, applied: null })).toBeNull();
  });

  it("approved and applied says what ran", () => {
    expect(outcomeLabel({ resolution: "approved", applied: true })).toBe(
      "Approved and applied",
    );
  });

  it("approved and NOT applied says so loudly", () => {
    const label = outcomeLabel({ resolution: "approved", applied: false });
    expect(label).toBe("Approved, nothing applied");
    expect(label).not.toBe("Approved and applied");
  });

  it("a dismissal never claims anything was applied", () => {
    expect(outcomeLabel({ resolution: "dismissed", applied: false })).toBe(
      "Dismissed",
    );
  });

  it("an approved row with applied unknown is treated as not applied", () => {
    // Rows resolved before migration 26 have applied = null. Reading that as
    // "applied" would be the exact lie this column exists to prevent.
    expect(outcomeLabel({ resolution: "approved", applied: null })).toBe(
      "Approved, applied unknown",
    );
  });
});
