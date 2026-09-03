import { describe, expect, it } from "vitest";
import { buildGroupedList, groupedRoster } from "@/lib/grouped-list";

const PRICE = 50000; // $500 in cents — money is stored in cents everywhere
const TOTAL = 100;

function person(over: Partial<Parameters<typeof groupedRoster>[0][number]> & { id: string }) {
  return {
    display_alias: null,
    full_name: `Person ${over.id}`,
    owner_group: "AVD",
    blocks_requested: 1,
    ...over,
  };
}

function blk(over: Partial<Parameters<typeof groupedRoster>[1][number]> & { block_number: number }) {
  return {
    participant_id: null,
    display_name: null,
    comped: false,
    status: "assigned",
    ...over,
  };
}

describe("groupedRoster — grouping and ordering", () => {
  const people = [
    person({ id: "a", display_alias: "Ava", owner_group: "AVD" }),
    person({ id: "r1", display_alias: "Ron1", owner_group: "RM" }),
    person({ id: "r2", display_alias: "Ron2", owner_group: "RM" }),
    person({ id: "m", display_alias: "Mike", owner_group: "MAP" }),
  ];
  const blocks = [
    blk({ block_number: 40, participant_id: "a" }),
    blk({ block_number: 7, participant_id: "r1" }),
    blk({ block_number: 3, participant_id: "r2" }),
    blk({ block_number: 90, participant_id: "m" }),
  ];

  it("orders owners by block count descending", () => {
    const r = groupedRoster(people, blocks, PRICE, TOTAL);
    expect(r.owners.map((g) => `${g.code}:${g.blocks}`)).toEqual([
      "RM:2",
      "AVD:1",
      "MAP:1",
    ]);
  });

  it("breaks a tie on block count by code, so the output is stable", () => {
    const r = groupedRoster(people, blocks, PRICE, TOTAL);
    const ones = r.owners.filter((g) => g.blocks === 1).map((g) => g.code);
    expect(ones).toEqual(["AVD", "MAP"]);
  });

  it("orders blocks inside an owner by number ascending", () => {
    const r = groupedRoster(people, blocks, PRICE, TOTAL);
    const rm = r.owners.find((g) => g.code === "RM")!;
    expect(rm.entries.map((e) => e.blockNumber)).toEqual([3, 7]);
  });

  it("omits a code holding no blocks — no empty EJD/NL/GD headers", () => {
    const r = groupedRoster(
      [...people, person({ id: "z", display_alias: "Zero", owner_group: "GD", blocks_requested: 0 })],
      blocks,
      PRICE,
      TOTAL,
    );
    expect(r.owners.map((g) => g.code)).not.toContain("GD");
  });
});

describe("groupedRoster — names", () => {
  it("uses the block's own display_name when it carries one", () => {
    const r = groupedRoster(
      [person({ id: "d", display_alias: "Dan DeSilvio", owner_group: "MAP" })],
      [blk({ block_number: 88, participant_id: "d", display_name: "Slav" })],
      PRICE,
      TOTAL,
    );
    expect(r.owners[0].entries[0].name).toBe("Slav");
  });

  it("falls back to the alias, then the full name", () => {
    const r = groupedRoster(
      [
        person({ id: "x", display_alias: "Gurt", full_name: "Konnor McGrorty", owner_group: "RM" }),
        person({ id: "y", display_alias: "   ", full_name: "Billy Fulg", owner_group: "RM" }),
      ],
      [
        blk({ block_number: 51, participant_id: "x" }),
        blk({ block_number: 52, participant_id: "y" }),
      ],
      PRICE,
      TOTAL,
    );
    expect(r.owners[0].entries.map((e) => e.name)).toEqual(["Gurt", "Billy Fulg"]);
  });
});

describe("groupedRoster — comped blocks count but owe nothing", () => {
  const r = groupedRoster(
    [person({ id: "a", display_alias: "AAA", owner_group: "AVD", blocks_requested: 2 })],
    [
      blk({ block_number: 3, participant_id: "a", comped: true }),
      blk({ block_number: 4, participant_id: "a" }),
    ],
    PRICE,
    TOTAL,
  );

  it("counts the comped block", () => {
    expect(r.owners[0].blocks).toBe(2);
    expect(r.committed).toBe(2);
  });

  it("charges nothing for it", () => {
    expect(r.owners[0].comped).toBe(1);
    expect(r.owners[0].dueCents).toBe(50000); // one payable block, not two
    expect(r.dueCents).toBe(50000);
  });
});

describe("groupedRoster — unnumbered commitments", () => {
  it("keeps a committed slot with no number in its owner's count", () => {
    const r = groupedRoster(
      [person({ id: "a", display_alias: "Ava", owner_group: "AVD", blocks_requested: 3 })],
      [blk({ block_number: 10, participant_id: "a" })],
      PRICE,
      TOTAL,
    );
    expect(r.owners[0].blocks).toBe(3);
    expect(r.owners[0].dueCents).toBe(150000);
    expect(r.owners[0].entries.map((e) => e.blockNumber)).toEqual([10, null, null]);
  });

  it("never invents a negative slot when someone holds more than requested", () => {
    const r = groupedRoster(
      [person({ id: "a", display_alias: "Ava", owner_group: "AVD", blocks_requested: 1 })],
      [
        blk({ block_number: 10, participant_id: "a" }),
        blk({ block_number: 11, participant_id: "a" }),
      ],
      PRICE,
      TOTAL,
    );
    expect(r.owners[0].blocks).toBe(2);
  });
});

describe("groupedRoster — what does not count", () => {
  it("ignores available and held blocks", () => {
    const r = groupedRoster(
      [person({ id: "a", display_alias: "Ava", blocks_requested: 0 })],
      [
        blk({ block_number: 1, participant_id: null, status: "available" }),
        blk({ block_number: 2, participant_id: "a", status: "held" }),
      ],
      PRICE,
      TOTAL,
    );
    expect(r.committed).toBe(0);
    expect(r.owners).toEqual([]);
  });

  it("computes open from the pool total, not from the block rows given", () => {
    const r = groupedRoster(
      [person({ id: "a", display_alias: "Ava", blocks_requested: 1 })],
      [blk({ block_number: 1, participant_id: "a" })],
      PRICE,
      TOTAL,
    );
    expect(r.open).toBe(99);
  });
});

describe("buildGroupedList — the pasteable text", () => {
  const roster = groupedRoster(
    [
      person({ id: "a", display_alias: "AAA", owner_group: "AVD", blocks_requested: 2 }),
      person({ id: "r", display_alias: "Gurt", owner_group: "RM" }),
      person({ id: "s", display_alias: "Dan DeSilvio", owner_group: "MAP" }),
    ],
    [
      blk({ block_number: 3, participant_id: "a", comped: true }),
      blk({ block_number: 40, participant_id: "a" }),
      blk({ block_number: 51, participant_id: "r" }),
      blk({ block_number: 88, participant_id: "s", display_name: "Slav" }),
    ],
    PRICE,
    TOTAL,
  );
  const text = buildGroupedList(2026, roster);

  it("prints the header in the agreed shape", () => {
    expect(text).toContain("AVD (2; $500 — 1 comped at $0)");
    expect(text).toContain("RM (1; $500)");
  });

  it("numbers entries within a group and shows the block number", () => {
    expect(text).toContain("1. AAA; #3 (comped)");
    expect(text).toContain("2. AAA; #40");
    expect(text).toContain("1. Slav; #88");
  });

  it("ends with committed, open and the money", () => {
    expect(text.trim().split("\n").pop()).toBe(
      "TOTAL: 4 committed, 96 open, $1,500 — 1 comped at $0",
    );
  });

  it("says nothing about comping when nothing is comped", () => {
    const clean = groupedRoster(
      [person({ id: "r", display_alias: "Gurt", owner_group: "RM" })],
      [blk({ block_number: 51, participant_id: "r" })],
      PRICE,
      TOTAL,
    );
    const t = buildGroupedList(2026, clean);
    expect(t).toContain("RM (1; $500)");
    expect(t).not.toContain("comped");
  });

  it("carries no markdown — it is pasted into a chat", () => {
    // "#88" is a block number, not a heading: a markdown heading is a "#"
    // at the start of a line followed by a space. Check the constructs a
    // chat client would actually render, not the characters.
    expect(text).not.toContain("**");
    expect(text).not.toContain("`");
    expect(text).not.toMatch(/^#{1,6} /m); // heading
    expect(text).not.toMatch(/^[-*] /m); // bullet
    expect(text).not.toMatch(/\[[^\]]*\]\([^)]*\)/); // link
    expect(text).not.toMatch(/(?<![A-Za-z0-9])_[^_\n]+_(?![A-Za-z0-9])/); // italic
  });

  it("marks an unnumbered slot instead of printing a bare hash", () => {
    const pending = groupedRoster(
      [person({ id: "a", display_alias: "Ava", owner_group: "AVD", blocks_requested: 2 })],
      [blk({ block_number: 10, participant_id: "a" })],
      PRICE,
      TOTAL,
    );
    expect(buildGroupedList(2026, pending)).toContain("2. Ava; no number yet");
  });
});
