import { describe, expect, it } from "vitest";
import { blockNameCandidates, namedBlocks } from "@/lib/block-names";
import type { AdminBlock, Participant } from "@/lib/types";

type P = Pick<Participant, "id" | "full_name" | "display_alias">;
type B = Pick<AdminBlock, "block_number" | "participant_id" | "display_name">;

const p = (id: string, full_name: string, display_alias: string | null = null): P => ({
  id,
  full_name,
  display_alias,
});
const b = (
  block_number: number,
  participant_id: string | null,
  display_name: string | null = null,
): B => ({ block_number, participant_id, display_name });

// The real roster shapes, so the rules are tested against what exists.
const ROSTER: P[] = [
  p("jrdiz", "Jr/Diz", "Jr/Diz"),
  p("cug1", "Marc Virga", "TEAM CUGINOS #1"),
  p("cug2", "Nick Fowler", "TEAM CUGINOS #2"),
  p("astorga", "Anthony Astorga", "Astorga"),
  p("aaa", "Anthony DellaPia", "AAA"),
  p("edd", "Ed D", "Ed D"),
  p("perry", "Perry T", "Perry T"),
  p("ilm", "Tim Flaherty & Mark Kap", "ILM!"),
  p("mm", "M & M", "M & M"),
  p("eddie", "Eddie/richie", "Eddie/richie"),
];
const BLOCKS: B[] = [
  b(36, "jrdiz"), b(38, "jrdiz"),
  b(64, "cug1"), b(62, "cug2"),
  b(41, "astorga"), b(73, "astorga"),
  b(3, "aaa"), b(5, "aaa"),
  b(9, "edd"), b(42, "edd"), b(93, "edd"),
  b(55, "perry"), b(60, "perry"),
  b(29, "ilm"),
  b(70, "mm"),
  b(6, "eddie"),
  b(1, null),
];

describe("blockNameCandidates", () => {
  const found = blockNameCandidates(ROSTER, BLOCKS);

  it("flags exactly the two known workarounds and nothing else", () => {
    expect(found).toHaveLength(2);
    expect(found.map((c) => c.reason).sort()).toEqual([
      "numbered_alias",
      "shared_record",
    ]);
  });

  it("groups the numbered pair as one candidate carrying both people", () => {
    const cug = found.find((c) => c.reason === "numbered_alias")!;
    expect(cug.aliases).toEqual(["TEAM CUGINOS #1", "TEAM CUGINOS #2"]);
    expect(cug.participantIds.sort()).toEqual(["cug1", "cug2"]);
    expect(cug.blocks).toEqual([62, 64]);
  });

  it("flags the one record holding two blocks under two joined names", () => {
    const jr = found.find((c) => c.reason === "shared_record")!;
    expect(jr.aliases).toEqual(["Jr/Diz"]);
    expect(jr.blocks).toEqual([36, 38]);
  });

  it("does NOT flag one person holding several blocks under one name", () => {
    const flagged = found.flatMap((c) => c.aliases);
    for (const ok of ["Astorga", "AAA", "Ed D", "Perry T"]) {
      expect(flagged).not.toContain(ok);
    }
  });

  it("does NOT flag joined names holding a single block — one block, one name", () => {
    const flagged = found.flatMap((c) => c.aliases);
    for (const ok of ["ILM!", "M & M", "Eddie/richie"]) {
      expect(flagged).not.toContain(ok);
    }
  });

  it("ignores unowned blocks without crashing", () => {
    expect(() => blockNameCandidates(ROSTER, [b(1, null)])).not.toThrow();
  });

  it("returns nothing for a roster with no workarounds", () => {
    expect(
      blockNameCandidates([p("x", "Solo Person", "Solo")], [b(2, "x"), b(3, "x")]),
    ).toEqual([]);
  });
});

describe("namedBlocks", () => {
  it("lists only blocks carrying their own name, in block order", () => {
    expect(
      namedBlocks([
        b(65, "marc", "PRESTIGE PULLZ"),
        b(25, "marc", "Marc Franklin Tv"),
        b(41, "astorga", null),
        b(42, "edd", "   "),
      ]),
    ).toEqual([
      { block_number: 25, display_name: "Marc Franklin Tv" },
      { block_number: 65, display_name: "PRESTIGE PULLZ" },
    ]);
  });
});
