import { describe, expect, it } from "vitest";
import { DISPATCH, dispatchFor, summarizePayload } from "@/lib/pending";

describe("dispatchFor", () => {
  it("routes a payment to admin_record_payment", () => {
    expect(dispatchFor("payment").rpc).toBe("admin_record_payment");
  });

  it("routes a block request to admin_reserve_blocks", () => {
    expect(dispatchFor("reserve_blocks").rpc).toBe("admin_reserve_blocks");
  });

  it("a kind with no dispatcher records the decision only", () => {
    const d = dispatchFor("non_matching_multiple");
    expect(d.rpc).toBeNull();
    expect(d.onApprove).toMatch(/by hand/);
  });

  it("every dispatcher names an admin_* RPC", () => {
    for (const d of Object.values(DISPATCH)) {
      expect(d.rpc).toMatch(/^admin_[a-z_]+$/);
    }
  });

  it("never dispatches to a write the queue must not perform", () => {
    // Marking a payout paid, releasing or holding a block, and reopening a
    // payout stay deliberate actions on their own admin pages. The dispatch
    // table is the whole list of what Approve can do.
    const forbidden = [
      "admin_settle_payout",
      "admin_reopen_payout",
      "admin_release_block",
      "admin_hold_block",
    ];
    for (const d of Object.values(DISPATCH)) {
      expect(forbidden).not.toContain(d.rpc);
    }
  });
});

describe("summarizePayload", () => {
  it("payment: amount, method, who, date and the Venmo txn", () => {
    expect(
      summarizePayload("payment", {
        participant_id: "7b1e0c2a-0000-4000-8000-000000000001",
        participant_name: "Gurt",
        amount_cents: 50000,
        method: "venmo",
        paid_on: "2026-09-04",
        venmo_txn_id: "4668875750736929799",
      }),
    ).toBe("$500 venmo from Gurt on 2026-09-04 (txn 4668875750736929799)");
  });

  it("payment: money is cents, never dollars", () => {
    expect(
      summarizePayload("payment", {
        participant_name: "Jr/Diz",
        amount_cents: 100000,
        method: "venmo",
        paid_on: "2026-09-03",
      }),
    ).toBe("$1,000 venmo from Jr/Diz on 2026-09-03");
  });

  it("payment: falls back to the participant id, and says what is missing", () => {
    expect(
      summarizePayload("payment", {
        participant_id: "7b1e0c2a-0000-4000-8000-000000000002",
        method: "cash",
      }),
    ).toBe(
      "amount ? cash from 7b1e0c2a-0000-4000-8000-000000000002 on date ?",
    );
  });

  it("payment: a non-integer amount is not rendered as money", () => {
    expect(
      summarizePayload("payment", {
        participant_name: "Somebody",
        amount_cents: "500",
        method: "venmo",
        paid_on: "2026-09-04",
      }),
    ).toBe("amount ? venmo from Somebody on 2026-09-04");
  });

  it("reserve_blocks: lists the blocks and the holder", () => {
    expect(
      summarizePayload("reserve_blocks", {
        participant_name: "Gurt",
        block_numbers: [51, 52],
        method: "requested",
      }),
    ).toBe("Blocks 51, 52 for Gurt (requested)");
  });

  it("reserve_blocks: an empty or malformed list shows a placeholder", () => {
    expect(
      summarizePayload("reserve_blocks", {
        participant_name: "Gurt",
        block_numbers: "51",
      }),
    ).toBe("Blocks ? for Gurt (requested)");
  });

  it("other kinds: scalar fields as key: value, in payload order", () => {
    expect(
      summarizePayload("non_matching_multiple", {
        amount_cents: 100000,
        sender: "Somebody",
        nested: { a: 1 },
        note: null,
        flagged: true,
      }),
    ).toBe("amount_cents: 100000 · sender: Somebody · flagged: true");
  });

  it("other kinds: a long payload is capped with a count of the rest", () => {
    const payload = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`k${i}`, i]),
    );
    expect(summarizePayload("identity_conflict", payload)).toBe(
      "k0: 0 · k1: 1 · k2: 2 · k3: 3 · k4: 4 · k5: 5 · +3 more",
    );
  });

  it("a payload that is not an object renders a placeholder", () => {
    expect(summarizePayload("payment", null)).toBe("(no details)");
    expect(summarizePayload("x", "text")).toBe("(no details)");
    expect(summarizePayload("x", [1, 2])).toBe("(no details)");
    expect(summarizePayload("x", {})).toBe("(no details)");
  });
});
