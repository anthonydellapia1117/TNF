// Disaster-recovery backup: the DATA as one runnable SQL file. The schema
// lives in the repo's migrations; this file restores everything else. The
// output is its own import — run it in the Supabase SQL editor on a project
// that already has the migrations applied, and the pool is back.

/** One value as a SQL literal. Strings are escaped by doubling quotes. */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number")
    return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (Array.isArray(v)) {
    // Only numeric arrays exist in this schema (row/col digits); anything
    // else would need element quoting we deliberately don't attempt.
    if (v.every((x) => typeof x === "number" && Number.isFinite(x)))
      return `'{${v.join(",")}}'`;
    throw new Error("unsupported array element type in backup");
  }
  if (typeof v === "object")
    return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Multi-row INSERTs for one table, chunked so no statement grows unwieldy. */
export function insertStatements(
  table: string,
  rows: Record<string, unknown>[],
  chunkSize = 50,
): string[] {
  if (rows.length === 0) return [];
  const columns = Object.keys(rows[0]);
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const statements: string[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const values = rows
      .slice(i, i + chunkSize)
      .map((r) => `  (${columns.map((c) => sqlLiteral(r[c])).join(", ")})`)
      .join(",\n");
    statements.push(`insert into ${table} (${colList}) values\n${values};`);
  }
  return statements;
}

/** FK-safe order: parents before children; audit last, config first. */
export const BACKUP_TABLES = [
  "config",
  "participants",
  "games",
  "blocks",
  "payments",
  "payouts",
  "audit_log",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export function buildBackupSql(
  data: Record<BackupTable, Record<string, unknown>[]>,
  generatedAtISO: string,
): string {
  const counts = BACKUP_TABLES.map(
    (t) => `--   ${t}: ${data[t].length} rows`,
  ).join("\n");
  const lines: string[] = [
    `-- 1622 TNF Block Pool — full data backup`,
    `-- Generated ${generatedAtISO}`,
    `--`,
    counts,
    `--`,
    `-- RESTORE (one step, on a project with the repo's migrations applied):`,
    `--   Paste this whole file into the Supabase SQL editor and run it.`,
    `--   It replaces ALL data with this snapshot. session_replication_role`,
    `--   suspends triggers (fixed-100 block set, digit immutability) and FK`,
    `--   checks for the duration of the load; everything is one transaction.`,
    ``,
    `begin;`,
    `set local session_replication_role = replica;`,
    ``,
    `truncate table ${[...BACKUP_TABLES].reverse().join(", ")} cascade;`,
    ``,
  ];
  for (const t of BACKUP_TABLES) {
    lines.push(`-- ${t} (${data[t].length} rows)`);
    lines.push(...insertStatements(t, data[t]));
    lines.push("");
  }
  lines.push(`commit;`);
  lines.push(``);
  return lines.join("\n");
}
