import { getAdminSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  BACKUP_TABLES,
  buildBackupSql,
  type BackupTable,
} from "@/lib/backup";

export const dynamic = "force-dynamic";

// Admin-only full data backup, as one runnable SQL file (its own import).
// Reads run as the signed-in admin session through RLS — no service key.

const ORDER_BY: Record<BackupTable, string> = {
  config: "id",
  participants: "id",
  games: "game_no",
  blocks: "block_number",
  payments: "id",
  payouts: "id",
  audit_log: "id",
};

const PAGE = 1000;

export async function GET() {
  const session = await getAdminSession();
  if (!session) return new Response("not authorized", { status: 401 });

  const supabase = await createSupabaseServerClient();

  // PostgREST caps a single select at 1000 rows — page until short read so
  // a long audit log never silently truncates the backup.
  async function fetchAll(table: BackupTable) {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .order(ORDER_BY[table], { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE) return rows;
    }
  }

  const entries = await Promise.all(
    BACKUP_TABLES.map(async (t) => [t, await fetchAll(t)] as const),
  );
  const data = Object.fromEntries(entries) as Record<
    BackupTable,
    Record<string, unknown>[]
  >;

  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const sql = buildBackupSql(data, now.toISOString());

  return new Response(sql, {
    headers: {
      "Content-Type": "application/sql; charset=utf-8",
      "Content-Disposition": `attachment; filename="tnf-backup-${stamp}.sql"`,
      "Cache-Control": "no-store",
    },
  });
}
