import * as XLSX from "xlsx-js-style";
import { getAdminSession } from "@/lib/auth";
import {
  getAdminBlocks,
  getAdminGames,
  getParticipantsWithFinance,
  getPayments,
  getPayouts,
} from "@/lib/data/admin";
import { gameCode } from "@/lib/pool";

export const dynamic = "force-dynamic";

// Admin-only Excel snapshot of the whole pool. Every figure is computed at
// read time from the same views the app uses — nothing here is stored.

type Cell = string | number | null;

function sheet(rows: Cell[][], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  const range = XLSX.utils.decode_range(ws["!ref"] as string);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) {
      ws[addr].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "1C2024" }, patternType: "solid" },
      };
    }
  }
  return ws;
}

const usd = (cents: number) => cents / 100;

export async function GET() {
  const session = await getAdminSession();
  if (!session) return new Response("not authorized", { status: 401 });

  const [participants, blocks, payments, games, payouts] = await Promise.all([
    getParticipantsWithFinance(),
    getAdminBlocks(),
    getPayments(),
    getAdminGames(),
    getPayouts(),
  ]);
  const names = new Map(
    participants.map((p) => [p.id, p.display_alias ?? p.full_name]),
  );
  const gameById = new Map(games.map((g) => [g.id, g]));

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [
        ["Name", "Alias", "Group", "Blocks requested", "Blocks held", "Assigned", "Due $", "Paid $", "Balance $", "Email", "Phone", "Source", "Notes"],
        ...participants.map((p) => [
          p.full_name,
          p.display_alias,
          p.owner_group,
          p.blocks_requested,
          p.finance.blocks_held,
          p.finance.blocks_assigned,
          usd(p.finance.amount_due_cents),
          usd(p.finance.amount_paid_cents),
          usd(p.finance.amount_paid_cents - p.finance.amount_due_cents),
          p.email,
          p.phone,
          p.source,
          p.notes,
        ]),
      ],
      [22, 18, 8, 14, 12, 10, 10, 10, 10, 28, 14, 10, 40],
    ),
    "Participants",
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [
        ["Date", "Participant", "Amount $", "Method", "Venmo txn", "Note", "Corrects"],
        ...payments.map((p) => [
          p.paid_on,
          p.participant_id ? (names.get(p.participant_id) ?? "?") : "UNMATCHED",
          usd(p.amount_cents),
          p.method,
          p.venmo_txn_id,
          p.note,
          p.corrects_payment_id ? "yes" : null,
        ]),
      ],
      [12, 22, 10, 10, 24, 36, 10],
    ),
    "Ledger",
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [
        ["Block", "Status", "Owner", "Method", "Assigned at", "Notes"],
        ...blocks.map((b) => [
          b.block_number,
          b.status,
          b.participant_id ? (names.get(b.participant_id) ?? "?") : null,
          b.assignment_method,
          b.assigned_at ? b.assigned_at.slice(0, 10) : null,
          b.notes,
        ]),
      ],
      [8, 10, 22, 10, 12, 40],
    ),
    "Blocks",
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [
        ["Game", "Type", "Block", "Winner", "Amount $", "Status", "Paid on", "Method"],
        ...payouts.map((po) => [
          gameById.has(po.game_id)
            ? gameCode((gameById.get(po.game_id) as { game_no: number }).game_no)
            : po.game_id,
          po.payout_type,
          po.block_number,
          po.participant_id ? (names.get(po.participant_id) ?? "?") : null,
          usd(po.amount_cents),
          po.status,
          po.paid_on,
          po.method,
        ]),
      ],
      [8, 10, 8, 22, 10, 8, 12, 10],
    ),
    "Payouts",
  );

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tnf-pool-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
