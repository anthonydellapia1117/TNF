import { describe, expect, it } from "vitest";
import { drawOrder, fnv1a32 } from "@/lib/block-draw";

const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("the block draw (docs/BLOCK_ASSIGNMENT_POLICY.md rule 2)", () => {
  it("hashes with FNV-1a 32 bit: the published test vector for 'a'", () => {
    expect(fnv1a32("a")).toBe(0xe40c292c);
  });

  // tests/sql/28_format_250.sql asserts the same two vectors against
  // block_draw_order(), so the SQL and TypeScript copies cannot drift apart.
  it("shuffles 1-10 under the test seed exactly as the SQL copy does", () => {
    expect(drawOrder("tnf-2026-blockdraw-test", upTo(10))).toEqual([5, 2, 6, 4, 3, 10, 7, 9, 1, 8]);
  });

  it("shuffles 1-100 under the test seed exactly as the SQL copy does", () => {
    expect(drawOrder("tnf-2026-blockdraw-test", upTo(100)).slice(0, 5)).toEqual([77, 1, 18, 89, 43]);
  });

  it("is a permutation of the free numbers and leaves the input alone", () => {
    const free = upTo(100);
    const out = drawOrder("s", free);
    expect([...out].sort((a, b) => a - b)).toEqual(upTo(100));
    expect(free).toEqual(upTo(100));
  });

  it("is decided by the seed alone", () => {
    expect(drawOrder("tnf-2026-blockdraw-27", upTo(50))).toEqual(drawOrder("tnf-2026-blockdraw-27", upTo(50)));
    expect(drawOrder("tnf-2026-blockdraw-27", upTo(50))).not.toEqual(drawOrder("tnf-2026-blockdraw-28", upTo(50)));
  });

  it("draws one number and no numbers as themselves", () => {
    expect(drawOrder("x", [7])).toEqual([7]);
    expect(drawOrder("x", [])).toEqual([]);
  });

  it("refuses a seed that is not printable ASCII", () => {
    expect(() => drawOrder("naïve", [1, 2])).toThrow(/printable ASCII/);
    expect(() => drawOrder("", [1, 2])).toThrow(/printable ASCII/);
  });
});
