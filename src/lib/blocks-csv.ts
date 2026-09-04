// The block grid as plain CSV, for an external renderer.
//
// One row per block, all 100, open blocks included — a grid renderer needs
// the empty cells as much as the taken ones, so this never filters.
//
// Admin only. owner_group is a collection field, not a public one, and the
// route that serves this gates on the admin session.
//
// Pure logic, unit-tested.

export interface BlockCsvRow {
  block_number: number;
  display_name: string | null;
  owner_group: string | null;
  status: string;
}

export const BLOCKS_CSV_HEADER = [
  "block_number",
  "display_name",
  "owner_group",
  "status",
] as const;

/**
 * One CSV field, RFC 4180.
 *
 * Quote when the value contains a comma, a double quote, or a line break;
 * inside quotes a double quote is doubled. null and undefined become an
 * empty field, which is what an open block's name and owner are — not the
 * string "null", which is what a naive join would write and what a renderer
 * would then print into the cell.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * The whole file. CRLF line endings per RFC 4180 — Excel on Windows is the
 * likeliest destination after the renderer, and it is the safer default for
 * everything else.
 */
export function buildBlocksCsv(rows: BlockCsvRow[]): string {
  const ordered = [...rows].sort((a, b) => a.block_number - b.block_number);
  const lines = [
    BLOCKS_CSV_HEADER.join(","),
    ...ordered.map((r) =>
      [
        csvField(r.block_number),
        csvField(r.display_name),
        csvField(r.owner_group),
        csvField(r.status),
      ].join(","),
    ),
  ];
  return lines.join("\r\n") + "\r\n";
}

/**
 * What a grid renderer assumes and would silently mis-draw without: exactly
 * 100 rows, numbered 1 to 100, each appearing once. Returns the problem as a
 * string, or null when the set is whole.
 *
 * This is here rather than in the route because a short read from PostgREST
 * is quiet — you get 99 rows and a 200, and the grid comes out with a hole
 * in it. The route raises instead of serving a partial file.
 */
export function blocksCsvGap(rows: BlockCsvRow[], total = 100): string | null {
  if (rows.length !== total) {
    return `expected ${total} block rows, got ${rows.length}`;
  }
  const seen = new Set(rows.map((r) => r.block_number));
  if (seen.size !== rows.length) {
    return `duplicate block numbers in the export (${rows.length} rows, ${seen.size} distinct)`;
  }
  for (let n = 1; n <= total; n++) {
    if (!seen.has(n)) return `block ${n} missing from the export`;
  }
  return null;
}
