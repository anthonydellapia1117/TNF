import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CircleDollarSign, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import { getConfig, getPot } from "@/lib/data/public";
import {
  buildAlerts,
  getAdminGames,
  getParticipantsWithFinance,
  getPayouts,
} from "@/lib/data/admin";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const [games, payouts, participants, config, pot] = await Promise.all([
    getAdminGames(),
    getPayouts(),
    getParticipantsWithFinance(),
    getConfig(),
    getPot(),
  ]);
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
        <a
          href="/api/export/pool.xlsx"
          className="shrink-0 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          Export .xlsx
        </a>
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
          value={`${config.price_per_block_cents > 0 ? Math.round(pot.due_cents / config.price_per_block_cents) : 0} committed`}
          sub={`${pot.reserved + pot.assigned} placed · ${fmtUsd(pot.due_cents)} due`}
        />
        <Stat label="Collected" value={fmtUsd(pot.collected_cents)} sub={`of ${fmtUsd(pot.due_cents)} due`} />
        <Stat label="Outstanding" value={fmtUsd(outstanding)} sub={`${unpaid.length} participant${unpaid.length === 1 ? "" : "s"} owe`} />
        <Stat label="Paid out" value={fmtUsd(pot.paid_out_cents)} sub={`${fmtUsd(pot.owed_out_cents)} owed to winners`} />
      </div>
    </div>
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
