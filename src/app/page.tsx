import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, LayoutGrid, Trophy, Wallet } from "lucide-react";
import { Countdown } from "@/components/dashboard/countdown";
import { HotDigits } from "@/components/dashboard/hot-digits";
import { StatusChip } from "@/components/grid/status-chip";
import {
  currentGame,
  getConfig,
  getPot,
  getPublicGames,
  getPublicPayouts,
} from "@/lib/data/public";
import { fmtDateOnly, fmtKickoffET, fmtUsd } from "@/lib/format";
import { teamInfo } from "@/lib/nfl";
import {
  committedBlocks,
  gameCode,
  lastDigit,
  payoutCents,
  placedBlocks,
  seasonPayoutTotalCents,
} from "@/lib/pool";
import type { PoolConfig, PublicGame } from "@/lib/types";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "The 2026 pool at a glance — next game, blocks, money, and winners.",
};

export const revalidate = 30;

function daysUntil(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.max(
    0,
    Math.ceil((Date.UTC(y, m - 1, d) - Date.now()) / 86_400_000),
  );
}

/** Last digit of every scored event across the season, bucketed 0-9. */
function digitCounts(games: PublicGame[]): number[] {
  const counts = Array.from({ length: 10 }, () => 0);
  for (const g of games) {
    if (g.halftime_home !== null && g.halftime_away !== null) {
      counts[lastDigit(g.halftime_home)]++;
      counts[lastDigit(g.halftime_away)]++;
    }
    if (g.final_home !== null && g.final_away !== null) {
      counts[lastDigit(g.final_home)]++;
      counts[lastDigit(g.final_away)]++;
    }
  }
  return counts;
}

function Hero({ game, config }: { game: PublicGame; config: PoolConfig }) {
  const away = teamInfo(game.away_team);
  const home = teamInfo(game.home_team);
  const half = payoutCents(game.game_type, "halftime", config);
  const fin = payoutCents(game.game_type, "final", config);

  return (
    <section className="rounded-lg border border-border bg-surface px-4 py-6 sm:px-6 sm:py-8">
      <div className="space-y-4 text-center sm:space-y-5">
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground" data-numeric>
            {gameCode(game.game_no)}
          </span>
          <span aria-hidden>·</span>
          <span data-numeric>Week {game.week}</span>
          {game.holiday_label && (
            <>
              <span aria-hidden>·</span>
              <span className="font-semibold tracking-wide text-holiday uppercase">
                {game.holiday_label}
              </span>
            </>
          )}
          <StatusChip game={game} />
        </div>

        <h1 className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 text-xl font-semibold sm:text-2xl">
          <span
            className="tracking-wide uppercase"
            style={{ color: away.color }}
          >
            {game.away_team}
          </span>
          <span className="text-sm font-normal text-muted-foreground">at</span>
          <span
            className="tracking-wide uppercase"
            style={{ color: home.color }}
          >
            {game.home_team}
          </span>
        </h1>

        <Countdown kickoffAt={game.kickoff_at} />

        <p className="text-sm text-muted-foreground" data-numeric>
          {fmtKickoffET(game.kickoff_at)}
          {game.network && (
            <>
              <span aria-hidden> · </span>
              {game.network}
            </>
          )}
        </p>

        <p className="text-sm text-muted-foreground" data-numeric>
          Halftime{" "}
          <span className="font-medium text-halftime">{fmtUsd(half)}</span>
          <span aria-hidden> · </span>
          Final <span className="font-medium text-final">{fmtUsd(fin)}</span>
        </p>

        <Link
          href="/grid"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium transition-colors duration-150 hover:border-pool-accent/60"
        >
          View the grid
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function StatCard({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="flex items-center gap-1.5 text-2xs font-semibold tracking-widest text-muted-foreground uppercase">
        {icon}
        {label}
      </p>
      {children}
    </div>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-2xs font-semibold tracking-widest text-muted-foreground uppercase">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function DashboardPage() {
  const [games, payouts, config, pot] = await Promise.all([
    getPublicGames(),
    getPublicPayouts(),
    getConfig(),
    getPot(),
  ]);

  const next = currentGame(games);
  const gamesById = new Map(games.map((g) => [g.id, g]));

  // COMMITTED drives money, PLACED drives the grid — computed independently
  // (tested in tests/unit/board.test.ts) and never conflated.
  const committed = committedBlocks(pot.due_cents, config.price_per_block_cents);
  const placed = placedBlocks(pot);
  const open = Math.max(0, config.blocks_total - committed);
  const committedPct =
    config.blocks_total > 0 ? (committed / config.blocks_total) * 100 : 0;

  const seasonTotal = seasonPayoutTotalCents(games, config);
  const paid = pot.paid_out_cents;
  const owed = pot.owed_out_cents;
  const remaining = Math.max(0, seasonTotal - paid - owed);
  const pctOf = (cents: number) =>
    seasonTotal > 0 ? `${(cents / seasonTotal) * 100}%` : "0%";

  const deadlineDays = daysUntil(config.claim_deadline);
  const recent = payouts.slice(0, 5);

  return (
    <div className="space-y-4">
      {next && <Hero game={next} config={config} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard
          label="Blocks committed"
          icon={<LayoutGrid className="size-3" aria-hidden />}
        >
          <p className="mt-2 text-2xl font-semibold" data-numeric>
            {committed}
            <span className="text-sm font-normal text-muted-foreground">
              /{config.blocks_total}
            </span>
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-pool-accent"
              style={{ width: `${committedPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground" data-numeric>
            {placed} placed · {open} open
          </p>
        </StatCard>

        <StatCard
          label="Collected"
          icon={<Wallet className="size-3" aria-hidden />}
        >
          <p className="mt-2 text-2xl font-semibold" data-numeric>
            {fmtUsd(pot.collected_cents)}
          </p>
          <p className="mt-1 text-2xs text-muted-foreground" data-numeric>
            {fmtUsd(config.price_per_block_cents)} per block
          </p>
        </StatCard>

        <StatCard
          label="Payouts remaining"
          icon={<Trophy className="size-3" aria-hidden />}
        >
          <p className="mt-2 text-2xl font-semibold" data-numeric>
            {fmtUsd(remaining)}
          </p>
          <p className="mt-1 text-2xs text-muted-foreground" data-numeric>
            of {fmtUsd(seasonTotal)}
          </p>
        </StatCard>

        <StatCard
          label="Next deadline"
          icon={<CalendarDays className="size-3" aria-hidden />}
        >
          <p className="mt-2 text-2xl font-semibold" data-numeric>
            {deadlineDays}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              {deadlineDays === 1 ? "day" : "days"}
            </span>
          </p>
          <p className="mt-1 text-2xs text-muted-foreground" data-numeric>
            Claim by {fmtDateOnly(config.claim_deadline)}
          </p>
        </StatCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {open > 0 && (
          <Link
            href="/blocks"
            className="flex flex-col justify-between gap-4 rounded-lg border border-pool-accent/60 bg-surface p-5 transition-colors duration-150 hover:border-pool-accent"
          >
            <div>
              <p className="text-2xs font-semibold tracking-widest text-pool-accent uppercase">
                Get in the pool
              </p>
              <p className="mt-2 text-3xl font-semibold" data-numeric>
                {open}
                <span className="text-lg font-normal text-muted-foreground">
                  {" "}
                  {open === 1 ? "block" : "blocks"} open
                </span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground" data-numeric>
                {fmtUsd(config.price_per_block_cents)} each · claim by{" "}
                {fmtDateOnly(config.claim_deadline)}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-pool-accent">
              Claim a block
              <ArrowRight className="size-4" aria-hidden />
            </span>
          </Link>
        )}

        <Panel
          title="Recent winners"
          action={
            <Link
              href="/winners"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              All winners
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          }
        >
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No winners yet — the season kicks off Sep 9.
            </p>
          ) : (
            <ul className="space-y-2">
              {recent.map((p) => {
                const game = gamesById.get(p.game_id);
                return (
                  <li key={p.id}>
                    <Link
                      href={`/block/${p.block_number}`}
                      className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2 transition-colors duration-150 hover:border-pool-accent/60"
                    >
                      <span
                        className="w-9 shrink-0 text-xs font-semibold text-muted-foreground"
                        data-numeric
                      >
                        {game ? gameCode(game.game_no) : "—"}
                      </span>
                      <span
                        className="text-sm font-semibold whitespace-nowrap"
                        data-numeric
                      >
                        Block {p.block_number}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                        {p.display_name ?? "Unclaimed"}
                      </span>
                      <span className="text-sm font-semibold" data-numeric>
                        {fmtUsd(p.amount_cents)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Season payout progress">
          <div
            className="flex h-2.5 overflow-hidden rounded-full bg-surface-2"
            role="img"
            aria-label={`${fmtUsd(paid)} paid, ${fmtUsd(owed)} owed, ${fmtUsd(remaining)} remaining of ${fmtUsd(seasonTotal)}`}
          >
            {paid > 0 && (
              <div className="bg-final" style={{ width: pctOf(paid) }} />
            )}
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
            {fmtUsd(seasonTotal)} in fixed payouts across {games.length} games.
          </p>
        </Panel>

        <Panel title="Hot digits">
          <HotDigits counts={digitCounts(games)} />
          <p className="mt-2 text-2xs text-muted-foreground">
            Winning last digits across every scored halftime and final.
          </p>
        </Panel>
      </div>
    </div>
  );
}
