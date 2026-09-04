import { getAdminSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  blocksCsvGap,
  buildBlocksCsv,
  type BlockCsvRow,
} from "@/lib/blocks-csv";

export const dynamic = "force-dynamic";

// Admin-only block export for an external grid renderer: one row per block,
// all 100, open blocks included.
//
// Admin-only because of owner_group. It is a collection field — which owner
// chases that block's $500 — and has no business on a public surface.
// Reads run as the signed-in admin session through RLS, no service key.

export async function GET() {
  const session = await getAdminSession();
  if (!session) return new Response("not authorized", { status: 401 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_public_blocks")
    .select("block_number, display_name, owner_group, status")
    .order("block_number", { ascending: true });

  if (error) {
    return new Response(`blocks: ${error.message}`, { status: 500 });
  }

  const rows = (data ?? []) as BlockCsvRow[];

  // A grid drawn from 99 rows has a hole in it and looks fine. Refuse rather
  // than serve a partial file.
  const gap = blocksCsvGap(rows);
  if (gap) return new Response(`incomplete export: ${gap}`, { status: 500 });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buildBlocksCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="tnf-blocks-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
