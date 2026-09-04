import { describe, expect, it } from "vitest";
import {
  blocksCsvGap,
  buildBlocksCsv,
  csvField,
  type BlockCsvRow,
} from "@/lib/blocks-csv";

function row(over: Partial<BlockCsvRow> & { block_number: number }): BlockCsvRow {
  return {
    display_name: null,
    owner_group: null,
    status: "available",
    ...over,
  };
}

/** A full 1-100 set, mostly open, for the invariant tests. */
function fullSet(): BlockCsvRow[] {
  return Array.from({ length: 100 }, (_, i) => row({ block_number: i + 1 }));
}

describe("csvField — RFC 4180 escaping", () => {
  it("leaves an ordinary value alone", () => {
    expect(csvField("Gurt")).toBe("Gurt");
    expect(csvField(51)).toBe("51");
  });

  it("writes an EMPTY field for null, never the text 'null'", () => {
    // An open block has no name and no owner. A renderer printing "null"
    // into 45 cells is the bug this guards.
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes a value containing a comma", () => {
    expect(csvField("Flaherty, Tim")).toBe('"Flaherty, Tim"');
  });

  it("quotes and doubles an embedded double quote", () => {
    expect(csvField('Rob "Robbie" G')).toBe('"Rob ""Robbie"" G"');
  });

  it("quotes a value containing a newline or carriage return", () => {
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField("two\r\nlines")).toBe('"two\r\nlines"');
  });

  it("does not quote characters that are not delimiters", () => {
    // Real names in this pool: slashes, ampersands, hashes, parens, bangs.
    for (const n of [
      "Jr/Diz",
      "M & M",
      "TEAM CUGINOS #1",
      "Breeze (Agnes)",
      "ILM!",
      "G/Hollywood",
    ]) {
      expect(csvField(n)).toBe(n);
    }
  });
});

describe("buildBlocksCsv", () => {
  it("leads with the agreed header", () => {
    expect(buildBlocksCsv([]).split("\r\n")[0]).toBe(
      "block_number,display_name,owner_group,status",
    );
  });

  it("writes one row per block, in block order, whatever order it is given", () => {
    const csv = buildBlocksCsv([
      row({ block_number: 51, display_name: "Gurt", owner_group: "JPOD", status: "assigned" }),
      row({ block_number: 2, display_name: "Cappy Lay", owner_group: "RM", status: "reserved" }),
    ]);
    expect(csv.trimEnd().split("\r\n")).toEqual([
      "block_number,display_name,owner_group,status",
      "2,Cappy Lay,RM,reserved",
      "51,Gurt,JPOD,assigned",
    ]);
  });

  it("keeps an open block as a row with two empty fields", () => {
    const csv = buildBlocksCsv([row({ block_number: 4 })]);
    expect(csv.trimEnd().split("\r\n")[1]).toBe("4,,,available");
  });

  it("escapes a name inside the assembled row", () => {
    const csv = buildBlocksCsv([
      row({ block_number: 7, display_name: 'Nards, "E."', owner_group: "AVD", status: "assigned" }),
    ]);
    expect(csv.trimEnd().split("\r\n")[1]).toBe('7,"Nards, ""E.""",AVD,assigned');
  });

  it("uses CRLF and ends with a trailing break", () => {
    const csv = buildBlocksCsv([row({ block_number: 1 })]);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).not.toMatch(/(?<!\r)\n/);
  });

  it("emits exactly 101 lines for a full pool — header plus 100", () => {
    const csv = buildBlocksCsv(fullSet());
    expect(csv.trimEnd().split("\r\n")).toHaveLength(101);
  });

  it("does not mutate the caller's array while sorting", () => {
    const rows = [row({ block_number: 9 }), row({ block_number: 3 })];
    buildBlocksCsv(rows);
    expect(rows.map((r) => r.block_number)).toEqual([9, 3]);
  });
});

describe("blocksCsvGap — a renderer needs all 100 or none", () => {
  it("passes a whole set", () => {
    expect(blocksCsvGap(fullSet())).toBeNull();
  });

  it("catches a short read, which PostgREST returns quietly", () => {
    expect(blocksCsvGap(fullSet().slice(0, 99))).toBe(
      "expected 100 block rows, got 99",
    );
  });

  it("catches a duplicate block number", () => {
    const rows = fullSet();
    rows[50] = row({ block_number: 1 });
    expect(blocksCsvGap(rows)).toMatch(/duplicate block numbers/);
  });

  it("names the missing block when the count still adds up", () => {
    // 100 rows, but 42 was replaced by a second 43 — count and distinctness
    // are both wrong here, so the duplicate check fires first; drop one and
    // add a 101st to isolate the missing-number path.
    const rows = fullSet().filter((r) => r.block_number !== 42);
    rows.push(row({ block_number: 101 }));
    expect(blocksCsvGap(rows)).toBe("block 42 missing from the export");
  });

  it("is not fooled by an out-of-range number padding the count", () => {
    const rows = fullSet().filter((r) => r.block_number !== 1);
    rows.push(row({ block_number: 0 }));
    expect(blocksCsvGap(rows)).toBe("block 1 missing from the export");
  });
});
