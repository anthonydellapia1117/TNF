import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, LayoutGrid } from "lucide-react";
import { Countdown } from "@/components/dashboard/countdown";
import { CloseCalls } from "@/components/dashboard/close-calls";
import { HolidayCard } from "@/components/dashboard/holiday-card";
import { HotCells } from "@/components/dashboard/hot-cells";
import { HotDigits } from "@/components/dashboard/hot-digits";
import { NextRevealCard } from "@/components/dashboard/next-reveal-card";
import { StatusChip } from "@/components/grid/status-chip";
import {
  currentGame,
  getConfig,
  getPublicBlocks,
  getPublicGames,
  getPublicPayouts,
} from "@/lib/data/public";
import { fmtDateLongET, fmtDateOnly, fmtKickoffET, fmtUsd } from "@/lib/format";
import { teamInfo } from "@/lib/nfl";
import { seasonStory } from "@/lib/next-reveal";
import {
  closeCalls,
  digitReport,
  hotCells,
  nextHolidayGame,
  repeatWinners,
} from "@/lib/fan-stats";
import { gameCode, payoutCents } from "@/lib/pool";
import {
  dashboardPanels,
  isSeasonMode,
  type DashboardPanel,
} from "@/lib/season-mode";
import type { PoolConfig, PublicGame } from "@/lib/types";

// Season mode reaches the link preview too: the description is what shows
// under the URL in a group chat, so it cannot still be selling blocks.
export async function generateMetadata(): Promise<Metadata> {
  const config = await getConfig();
  return {
    title: "Dashboard",
    description: isSeasonMode(config)
      ? "The 2026 season — next game, the grid, and who is winning."
      : "The 2026 pool at a glance — next game, blocks, money, and winners.",
  };
}

export const revalidate = 30;

function daysUntil(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.max(
    0,
    Math.ceil((Date.UTC(y, m - 1, d) - Date.now()) / 86_400_000),
  );
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

/**
 * Season mode's second panel: straight into the grid. Off-season the hero
 * already carries a "View the grid" link, so this only appears when the
 * dashboard has stopped selling and the grid is the point.
 */
function GridLink({ game }: { game: PublicGame | null }) {
  return (
    <Link
      href="/grid"
      className="group flex flex-col justify-between gap-4 rounded-lg border border-pool-accent/60 bg-surface p-5 transition-colors duration-150 hover:border-pool-accent"
    >
      <div>
        <p className="text-2xs font-semibold tracking-widest text-pool-accent uppercase">
          <LayoutGrid className="mr-1.5 inline size-3" aria-hidden />
          The grid
        </p>
        <p className="mt-2 text-lg font-semibold">
          {game
            ? `Your numbers for ${gameCode(game.game_no)}`
            : "All 100 blocks, every game"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Find your block, see the digits, watch it live.
        </p>
      </div>
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-pool-accent">
        Open the grid
        <ArrowRight
          className="size-4 transition-transform duration-150 group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </Link>
  );
}

export default async function DashboardPage() {
  // No getPot() here on purpose. Collection status and the committed count
  // are administrative and live on /admin, so the viewer dashboard has no
  // reason to read the money projection at all.
  const [games, payouts, config, blocks] = await Promise.all([
    getPublicGames(),
    getPublicPayouts(),
    getConfig(),
    getPublicBlocks(),
  ]);

  const next = currentGame(games);
  const gamesById = new Map(games.map((g) => [g.id, g]));

  const story = seasonStory(games, payouts);
  const deadlineDays = daysUntil(config.claim_deadline);
  const recent = payouts.slice(0, 5);

  // The season, as a fan sees it.
  const digits = digitReport(games);
  const calls = closeCalls(games, blocks);
  const cells = hotCells(games);
  const holiday = nextHolidayGame(games, config, Date.now());
  const repeats = repeatWinners(payouts);

  // What this page shows, and in what order, is decided in one tested place.
  const seasonMode = isSeasonMode(config);
  const panels = dashboardPanels(seasonMode, { hasNextGame: next !== null });
  const shows = (p: DashboardPanel) => panels.includes(p);

  return (
    <div className="space-y-4">
      {next && <Hero game={next} config={config} />}

      {/* Everything a viewer needs at a glance: when the numbers drop, and
          the next holiday game. Nothing about collection or headcount. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
        <NextRevealCard games={games} payouts={payouts} blocks={blocks} />

        {shows("holiday_next") && <HolidayCard holiday={holiday} />}

        {shows("claim_deadline") && (
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
        )}

        {shows("grid_link") && <GridLink game={next} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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

        <Panel title="Season so far">
          {story.preSeason ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Season starts {fmtDateLongET(story.firstKickoffISO)}.
            </p>
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">Games played</dt>
                <dd className="font-medium" data-numeric>
                  {story.gamesPlayed} of {story.gamesTotal}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">Paid out so far</dt>
                <dd className="font-medium" data-numeric>
                  {fmtUsd(story.paidOutCents)}
                </dd>
              </div>
              {story.biggestWin && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Biggest single win</dt>
                  <dd className="font-medium" data-numeric>
                    {fmtUsd(story.biggestWin.cents)}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {story.biggestWin.label}
                    </span>
                  </dd>
                </div>
              )}
              {story.mostWins && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Most wins</dt>
                  <dd className="max-w-40 truncate font-medium" data-numeric>
                    {story.mostWins.name}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {story.mostWins.count}
                    </span>
                  </dd>
                </div>
              )}
              {repeats.length > 1 && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-muted-foreground">
                    Won more than once
                  </dt>
                  <dd
                    className="min-w-0 truncate text-right font-medium"
                    data-numeric
                  >
                    {repeats
                      .map((r) => `${r.name} ×${r.wins}`)
                      .join(" · ")}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </Panel>

        {shows("hot_digits") && (
          <Panel title="Hot digits">
            <HotDigits report={digits} />
            <p className="mt-2 text-2xs text-muted-foreground">
              Winning last digits across every scored halftime and final.
            </p>
          </Panel>
        )}

        {shows("close_calls") && (
          <Panel title="Close calls">
            <CloseCalls calls={calls} gamesPlayed={story.gamesPlayed} />
            <p className="mt-2 text-2xs text-muted-foreground">
              Blocks that would have won if either team had scored one more
              point, or one fewer.
            </p>
          </Panel>
        )}

        {shows("hot_cells") && (
          <Panel title="Score patterns">
            <HotCells cells={cells} gamesPlayed={story.gamesPlayed} />
          </Panel>
        )}
      </div>
    </div>
  );
}
