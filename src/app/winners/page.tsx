import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { getPublicGames, getPublicPayouts } from "@/lib/data/public";
import { fmtDateET, fmtUsd } from "@/lib/format";
import { matchupLabel } from "@/lib/nfl";
import { gameCode } from "@/lib/pool";
import { cn } from "@/lib/utils";
import type { PayoutType, PublicPayout } from "@/lib/types";

export const metadata: Metadata = {
  title: "Winners",
  description: "Season standings by total winnings, and every payout so far.",
};

export const revalidate = 30;

const MEDALS = ["🥇", "🥈", "🥉"];

interface Standing {
  key: string;
  name: string;
  totalCents: number;
  hits: number;
  blocks: number[];
}

/** Totals per winner, keyed by participant (falling back to display name). */
function buildStandings(payouts: PublicPayout[]): Standing[] {
  const byKey = new Map<string, Standing>();
  for (const p of payouts) {
    const key = p.participant_id ?? p.display_name ?? "unclaimed";
    const row = byKey.get(key) ?? {
      key,
      name: p.display_name ?? "Unclaimed",
      totalCents: 0,
      hits: 0,
      blocks: [],
    };
    row.totalCents += p.amount_cents;
    row.hits += 1;
    if (!row.blocks.includes(p.block_number)) row.blocks.push(p.block_number);
    byKey.set(key, row);
  }
  return Array.from(byKey.values()).sort(
    (a, b) =>
      b.totalCents - a.totalCents ||
      b.hits - a.hits ||
      a.name.localeCompare(b.name),
  );
}

function PayoutBadge({ type }: { type: PayoutType }) {
  const isFinal = type === "final";
  return (
    <span
      className={cn(
        "inline-flex w-12 shrink-0 items-center justify-center rounded-full border px-1.5 py-0.5 text-2xs font-semibold tracking-wide",
        isFinal
          ? "border-final/50 bg-final/15 text-final"
          : "border-halftime/50 bg-halftime/15 text-halftime",
      )}
    >
      {isFinal ? "FINAL" : "HALF"}
    </span>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-2xs font-semibold tracking-widest text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

export default async function WinnersPage() {
  const [payouts, games] = await Promise.all([
    getPublicPayouts(),
    getPublicGames(),
  ]);

  const gamesById = new Map(games.map((g) => [g.id, g]));
  const standings = buildStandings(payouts);
  const totalCents = payouts.reduce((sum, p) => sum + p.amount_cents, 0);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Winners</h1>
        <p className="text-sm text-muted-foreground" data-numeric>
          {payouts.length === 0
            ? "Season standings and every payout, game by game."
            : `${fmtUsd(totalCents)} won across ${payouts.length} ${
                payouts.length === 1 ? "payout" : "payouts"
              }`}
        </p>
      </header>

      {payouts.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-16 text-center">
          <Trophy
            className="mx-auto size-12 text-muted-foreground/40"
            aria-hidden
          />
          <p className="mt-4 text-base font-medium">No winners yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The first game is Wed Sep 9.
          </p>
          <Link
            href="/schedule"
            className="mt-5 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium transition-colors duration-150 hover:border-pool-accent/60"
          >
            See the schedule
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <SectionTitle>Season standings</SectionTitle>
            <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {standings.map((s, i) => (
                <li
                  key={s.key}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span
                    className="w-7 shrink-0 text-right text-sm font-semibold text-muted-foreground"
                    data-numeric
                  >
                    {i + 1}.
                  </span>
                  <span className="w-6 shrink-0 text-center text-sm" aria-hidden>
                    {MEDALS[i] ?? ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.name}</p>
                    <p
                      className="truncate text-2xs text-muted-foreground"
                      data-numeric
                    >
                      {s.hits} {s.hits === 1 ? "hit" : "hits"} ·{" "}
                      {s.blocks.length === 1 ? "Block" : "Blocks"}{" "}
                      {Array.from(s.blocks)
                        .sort((a, b) => a - b)
                        .join(", ")}
                    </p>
                  </div>
                  <span
                    className="shrink-0 text-sm font-semibold text-final"
                    data-numeric
                  >
                    {fmtUsd(s.totalCents)}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="space-y-2">
            <SectionTitle>All payouts</SectionTitle>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {payouts.map((p) => {
                const game = gamesById.get(p.game_id);
                return (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <span
                      className="w-9 shrink-0 text-sm font-semibold"
                      data-numeric
                    >
                      {game ? gameCode(game.game_no) : "—"}
                    </span>
                    <span className="hidden w-24 shrink-0 truncate text-xs text-muted-foreground sm:inline">
                      {game
                        ? matchupLabel(game.away_team, game.home_team)
                        : ""}
                    </span>
                    <PayoutBadge type={p.payout_type} />
                    <Link
                      href={`/block/${p.block_number}`}
                      className="shrink-0 text-sm font-semibold whitespace-nowrap transition-colors duration-150 hover:text-pool-accent"
                      data-numeric
                    >
                      Block {p.block_number}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {p.display_name ?? "Unclaimed"}
                    </span>
                    <span
                      className="hidden shrink-0 text-xs text-muted-foreground md:inline"
                      data-numeric
                    >
                      {fmtDateET(p.created_at)}
                    </span>
                    <span
                      className="shrink-0 text-sm font-semibold"
                      data-numeric
                    >
                      {fmtUsd(p.amount_cents)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
