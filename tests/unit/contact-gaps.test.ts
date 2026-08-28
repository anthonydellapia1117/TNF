import { describe, expect, it } from "vitest";
import {
  contactGapMessage,
  contactGaps,
  hasNoContact,
} from "@/lib/contact-gaps";
import type { OwnerGroup, Participant } from "@/lib/types";

type P = Pick<
  Participant,
  "id" | "full_name" | "display_alias" | "email" | "phone" | "owner_group"
>;

const person = (over: Partial<P> & { id: string }): P => ({
  full_name: "Somebody",
  display_alias: null,
  email: null,
  phone: null,
  owner_group: "RM" as OwnerGroup,
  ...over,
});

describe("hasNoContact", () => {
  it("needs BOTH channels missing — one is enough to reach a winner", () => {
    expect(hasNoContact({ email: null, phone: null })).toBe(true);
    expect(hasNoContact({ email: "a@b.com", phone: null })).toBe(false);
    expect(hasNoContact({ email: null, phone: "215-555-0100" })).toBe(false);
  });

  it("treats whitespace as missing, not as contact", () => {
    expect(hasNoContact({ email: "   ", phone: "" })).toBe(true);
  });
});

describe("contactGaps", () => {
  const blocks = [
    { block_number: 42, participant_id: "ed" },
    { block_number: 9, participant_id: "ed" },
    { block_number: 93, participant_id: "ed" },
    { block_number: 8, participant_id: "lz" },
    { block_number: 21, participant_id: "cap" },
    { block_number: 99, participant_id: "reachable" },
    { block_number: 7, participant_id: null }, // unowned, must not crash
  ];
  const people = [
    person({ id: "ed", display_alias: "Ed D", owner_group: "MAP" }),
    person({ id: "lz", display_alias: "LZ", owner_group: "MAP" }),
    person({ id: "cap", display_alias: "Captain", owner_group: "RM" }),
    person({
      id: "reachable",
      display_alias: "Rob",
      email: "rob@example.com",
      owner_group: "AVD",
    }),
  ];

  it("lists only the unreachable, grouped by relaying owner", () => {
    const gaps = contactGaps(people, blocks);
    expect(gaps.map((g) => g.group)).toEqual(["MAP", "RM"]);
    expect(gaps.flatMap((g) => g.people.map((p) => p.name))).not.toContain(
      "Rob",
    );
  });

  it("orders groups by blocks at stake, biggest gap first", () => {
    const gaps = contactGaps(people, blocks);
    expect(gaps[0]).toMatchObject({ group: "MAP", blockCount: 4 });
    expect(gaps[1]).toMatchObject({ group: "RM", blockCount: 1 });
  });

  it("keeps one person's several blocks on one row, sorted", () => {
    const [map] = contactGaps(people, blocks);
    const ed = map.people.find((p) => p.name === "Ed D");
    expect(ed?.blocks).toEqual([9, 42, 93]);
    expect(map.people.filter((p) => p.name === "Ed D")).toHaveLength(1);
  });

  it("falls back to full_name when there is no alias", () => {
    const [g] = contactGaps(
      [person({ id: "x", full_name: "Vincent Angiolillo" })],
      [],
    );
    expect(g.people[0].name).toBe("Vincent Angiolillo");
  });

  it("returns nothing when everyone is reachable", () => {
    expect(contactGaps([people[3]], blocks)).toEqual([]);
  });
});

describe("contactGapMessage", () => {
  it("names each person with their blocks and asks for either channel", () => {
    const msg = contactGapMessage({
      group: "MAP",
      blockCount: 4,
      people: [
        { id: "ed", name: "Ed D", blocks: [9, 42, 93] },
        { id: "lz", name: "LZ", blocks: [8] },
      ],
    });
    expect(msg).toContain("Ed D - #9, #42, #93");
    expect(msg).toContain("LZ - #8");
    expect(msg).toContain("2 people");
    expect(msg).toContain("Cell or email is fine");
  });

  it("handles someone with no block yet without a dangling dash", () => {
    const msg = contactGapMessage({
      group: "RM",
      blockCount: 0,
      people: [{ id: "a", name: "Captain", blocks: [] }],
    });
    expect(msg).toContain("Captain");
    expect(msg).not.toContain("Captain -");
    expect(msg).toContain("1 person");
  });
});
