import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CircleDollarSign, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { BlockNames } from "@/components/admin/block-names";
import { ContactGaps } from "@/components/admin/contact-gaps";
import { PlayersDetailToggle } from "@/components/admin/players-detail-toggle";
import { SeasonModeToggle } from "@/components/admin/season-mode-toggle";
import { fmtUsd } from "@/lib/format";
import {
  committedBlocks,
  housePosition,
  placedBlocks,
  seasonPayoutTotalCents,
} from "@/lib/pool";
import { blockNameCandidates, namedBlocks } from "@/lib/block-names";
import { contactGaps } from "@/lib/contact-gaps";
import { getConfig, getPot } from "@/lib/data/public";
import type { Pot } from "@/lib/types";
import {
  buildAlerts,
  getAdminBlocks,
  getAdminGames,
  getParticipantsWithFinance,
  getPayouts,
} from "@/lib/data/admin";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const [games, payouts, participants, config, pot, blocks] = await Promise.all([
    getAdminGames(),
    getPayouts(),
    getParticipantsWithFinance(),
    getConfig(),
    getPot(),
    getAdminBlocks(),
  ]);
  // Comped blocks are admin-only: the count comes from the blocks table
  // under admin RLS, never from a public projection.
  const comped = blocks.filter((b) => b.comped).length;
  // Who cannot be reached if their block hits, grouped by relaying owner.
  const gaps = contactGaps(participants, blocks);
  // Blocks with their own name, plus the naming that predates the column.
  const named = namedBlocks(blocks);
  const nameCandidates = blockNameCandidates(participants, blocks);
  const alerts = buildAlerts(games, payouts, participants, config.claim_deadline);

  const unpaid = participants.filter(
    (p) => p.finance.amount_paid_cents < p.finance.amount_due_cents,
  );
  const outstanding = unpaid.reduce(
    (s, p) => s + (p.finance.amount_due_cents - p.finance.amount_paid_cents),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl">Overview</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            What needs attention, in priority order.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            href="/api/export/pool.xlsx"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            Export .xlsx
          </a>
          <a
            href="/api/export/blocks.csv"
            title="All 100 blocks as plain CSV — block_number, display_name, owner_group, status — for an external grid renderer"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            Blocks .csv
          </a>
          <a
            href="/api/export/backup.sql"
            title="Full data backup — one runnable SQL file that restores everything"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            Backup
          </a>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing needs attention. Enjoy it while it lasts.
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <Link
              key={i}
              href={a.href}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors duration-150",
                a.level === "red" &&
                  "border-destructive/50 bg-destructive/10 hover:bg-destructive/15",
                a.level === "amber" &&
                  "border-halftime/50 bg-halftime/10 hover:bg-halftime/15",
                a.level === "blue" &&
                  "border-live/50 bg-live/10 hover:bg-live/15",
              )}
            >
              {a.level === "red" ? (
                <OctagonAlert className="size-4 shrink-0 text-destructive" />
              ) : a.level === "amber" ? (
                <AlertTriangle className="size-4 shrink-0 text-halftime" />
              ) : (
                <CircleDollarSign className="size-4 shrink-0 text-live" />
              )}
              <span>{a.text}</span>
            </Link>
          ))}
        </div>
      )}

      {/* COMMITTED (agreed to buy, drives money) vs PLACED (has a number on
          the grid) — two concepts, never labeled as each other. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Blocks"
          value={`${committedBlocks(pot)} committed`}
          sub={`${placedBlocks(pot)} placed · ${fmtUsd(pot.due_cents ?? 0)} due`}
        />
        <Stat label="Collected" value={fmtUsd(pot.collected_cents ?? 0)} sub={`of ${fmtUsd(pot.due_cents ?? 0)} due`} />
        <Stat label="Outstanding" value={fmtUsd(outstanding)} sub={`${unpaid.length} participant${unpaid.length === 1 ? "" : "s"} owe`} />
        <Stat label="Paid out" value={fmtUsd(pot.paid_out_cents)} sub={`${fmtUsd(pot.owed_out_cents ?? 0)} owed to winners`} />
      </div>

      {/* The number the owner manages to: collected against the FIXED
          payout, and how many more blocks must sell to break even. Admin
          only — this never appears on any public route. */}
      <HousePosition
        pot={pot}
        comped={comped}
        seasonTotal={seasonPayoutTotalCents(games, config)}
        pricePerBlock={config.price_per_block_cents}
      />

      <ContactGaps groups={gaps} />

      <BlockNames named={named} candidates={nameCandidates} />

      <SeasonModeToggle current={config.season_mode === true} />

      <PlayersDetailToggle current={config.players_detail ?? "full"} />

      {/* The full liability picture lives here and only here — the public
          dashboard tells the season's story, never the balance sheet. */}
      <SeasonPayoutProgress
        seasonTotal={seasonPayoutTotalCents(games, config)}
        paid={pot.paid_out_cents}
        owed={pot.owed_out_cents ?? 0}
        gameCount={games.length}
      />
    </div>
  );
}

function HousePosition({
  pot,
  comped,
  seasonTotal,
  pricePerBlock,
}: {
  pot: Pot;
  comped: number;
  seasonTotal: number;
  pricePerBlock: number;
}) {
  const h = housePosition(pot, comped, seasonTotal, pricePerBlock);
  const behind = h.positionCents < 0;
  const pct =
    h.payingBlocksNeeded > 0
      ? Math.min(100, (h.payingBlocksSold / h.payingBlocksNeeded) * 100)
      : 0;
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-2xs font-semibold tracking-widest text-muted-foreground uppercase">
        House position
        <span className="rounded border border-border px-1 py-px text-[9px] tracking-normal normal-case">
          admin only
        </span>
      </h2>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums",
            behind ? "text-destructive" : "text-emerald-400",
          )}
          data-numeric
        >
          {behind ? "−" : "+"}
          {fmtUsd(Math.abs(h.positionCents))}
        </p>
        <p className="text-sm text-muted-foreground" data-numeric>
          {fmtUsd(pot.collected_cents ?? 0)} collected − {fmtUsd(seasonTotal)} fixed
          payout
        </p>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            "h-full rounded-full",
            h.blocksToBreakEven === 0 ? "bg-emerald-500" : "bg-halftime",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="mt-2 text-sm" data-numeric>
        {h.blocksToBreakEven === 0 ? (
          <span className="text-emerald-400">
            Break-even cleared — {h.payingBlocksSold} paying blocks sold.
          </span>
        ) : (
          <>
            <span className="font-semibold text-halftime">
              {h.blocksToBreakEven} more paying blocks
            </span>{" "}
            <span className="text-muted-foreground">
              to break even — {h.payingBlocksSold} of {h.payingBlocksNeeded} sold
              {comped > 0
                ? ` · ${comped} comped (owes nothing, still in play)`
                : ""}
            </span>
          </>
        )}
      </p>
    </section>
  );
}

function SeasonPayoutProgress({
  seasonTotal,
  paid,
  owed,
  gameCount,
}: {
  seasonTotal: number;
  paid: number;
  owed: number;
  gameCount: number;
}) {
  const remaining = Math.max(0, seasonTotal - paid - owed);
  const pctOf = (cents: number) =>
    seasonTotal > 0 ? `${(cents / seasonTotal) * 100}%` : "0%";
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-3 text-2xs font-semibold tracking-widest text-muted-foreground uppercase">
        Season payout progress
      </h2>
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`${fmtUsd(paid)} paid, ${fmtUsd(owed)} owed, ${fmtUsd(remaining)} remaining of ${fmtUsd(seasonTotal)}`}
      >
        {paid > 0 && <div className="bg-final" style={{ width: pctOf(paid) }} />}
        {owed > 0 && (
          <div className="bg-halftime" style={{ width: pctOf(owed) }} />
        )}
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-final" aria-hidden />
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="font-medium" data-numeric>
            {fmtUsd(paid)}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-halftime" aria-hidden />
          <dt className="text-muted-foreground">Owed</dt>
          <dd className="font-medium" data-numeric>
            {fmtUsd(owed)}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-surface-2" aria-hidden />
          <dt className="text-muted-foreground">Remaining</dt>
          <dd className="font-medium" data-numeric>
            {fmtUsd(remaining)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-2xs text-muted-foreground" data-numeric>
        {fmtUsd(seasonTotal)} in fixed payouts across {gameCount} games.
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-2xs tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums" data-numeric>
        {value}
      </p>
      <p className="mt-0.5 text-2xs text-muted-foreground" data-numeric>
        {sub}
      </p>
    </div>
  );
}
