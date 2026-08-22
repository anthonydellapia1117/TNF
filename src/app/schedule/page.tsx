import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { StatusChip } from "@/components/grid/status-chip";
import { getConfig, getPublicGames } from "@/lib/data/public";
import { fmtKickoffET, fmtUsd } from "@/lib/format";
import { teamInfo } from "@/lib/nfl";
import { gameCode, payoutCents, seasonPayoutTotalCents } from "@/lib/pool";
import { cn } from "@/lib/utils";
import type { PoolConfig, PublicGame } from "@/lib/types";

export const metadata: Metadata = {
  title: "Schedule",
  description:
    "All 23 games — dates, matchups, networks, payouts, and holiday specials.",
};

export const revalidate = 30;

/** Score to show on a schedule row: final preferred, else halftime. */
function rowScore(game: PublicGame): { away: number; home: number } | null {
  if (game.final_home !== null && game.final_away !== null) {
    return { away: game.final_away, home: game.final_home };
  }
  if (game.halftime_home !== null && game.halftime_away !== null) {
    return { away: game.halftime_away, home: game.halftime_home };
  }
  return null;
}

function HolidayTag({ label }: { label: string | null }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-holiday/50 bg-holiday/15 px-2 py-0.5 text-2xs font-semibold tracking-wide whitespace-nowrap text-holiday uppercase">
      {label ?? "Holiday"}
    </span>
  );
}

/** Kickoff date; amber when the date is not locked in yet. */
function GameDate({ game }: { game: PublicGame }) {
  const unconfirmed = !game.date_confirmed;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5",
        unconfirmed ? "text-halftime" : "text-muted-foreground",
      )}
      data-numeric
    >
      {/* Amber text alone flags an unconfirmed date — the row's status chip
          already says DATE TBD, so no second tag here. */}
      <span className="truncate">{fmtKickoffET(game.kickoff_at)}</span>
    </span>
  );
}

function Score({ game }: { game: PublicGame }) {
  const score = rowScore(game);
  if (!score) return null;
  return (
    <span
      className="text-sm font-semibold whitespace-nowrap"
      data-numeric
      title={`${game.away_team} ${score.away} at ${game.home_team} ${score.home}`}
    >
      {score.away}&ndash;{score.home}
    </span>
  );
}

function PayoutPair({
  game,
  config,
}: {
  game: PublicGame;
  config: PoolConfig;
}) {
  const half = payoutCents(game.game_type, "halftime", config);
  const fin = payoutCents(game.game_type, "final", config);
  return (
    <span className="text-sm whitespace-nowrap" data-numeric>
      <span className="font-medium text-halftime">{fmtUsd(half)}</span>
      <span className="text-muted-foreground"> / </span>
      <span className="font-medium text-final">{fmtUsd(fin)}</span>
    </span>
  );
}

/** Desktop row: game · date · matchup · network · payouts · state (~40px). */
function DesktopRow({
  game,
  config,
}: {
  game: PublicGame;
  config: PoolConfig;
}) {
  const away = teamInfo(game.away_team);
  const home = teamInfo(game.home_team);
  const holiday = game.game_type === "holiday";

  return (
    <Link
      href={`/grid?g=${game.game_no}`}
      className={cn(
        "grid grid-cols-[3rem_13rem_minmax(0,1fr)_4rem_9.5rem_auto] items-center gap-3 border-l-4 px-4 py-2 transition-colors duration-150 hover:bg-surface-2",
        holiday ? "border-l-holiday" : "border-l-transparent",
      )}
    >
      <span className="text-sm font-semibold" data-numeric>
        {gameCode(game.game_no)}
      </span>

      <span className="flex min-w-0 text-sm">
        <GameDate game={game} />
      </span>

      <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
        <span
          className="truncate font-medium tracking-wide uppercase"
          style={{ color: away.color }}
          title={game.away_team}
        >
          {game.away_team}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">at</span>
        <span
          className="truncate font-medium tracking-wide uppercase"
          style={{ color: home.color }}
          title={game.home_team}
        >
          {game.home_team}
        </span>
        {holiday && <HolidayTag label={game.holiday_label} />}
      </span>

      <span className="truncate text-xs text-muted-foreground">
        {game.network ?? "—"}
      </span>

      <PayoutPair game={game} config={config} />

      <span className="flex items-center justify-end gap-2">
        <Score game={game} />
        <StatusChip game={game} />
      </span>
    </Link>
  );
}

/** Mobile card: everything the desktop row shows, stacked. */
function MobileCard({
  game,
  config,
}: {
  game: PublicGame;
  config: PoolConfig;
}) {
  const away = teamInfo(game.away_team);
  const home = teamInfo(game.home_team);
  const holiday = game.game_type === "holiday";

  return (
    <Link
      href={`/grid?g=${game.game_no}`}
      className={cn(
        "block rounded-lg border border-border bg-surface p-3 transition-colors duration-150 hover:bg-surface-2",
        holiday && "border-l-4 border-l-holiday",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <span className="shrink-0 font-semibold" data-numeric>
            {gameCode(game.game_no)}
          </span>
          <span className="truncate font-semibold" data-numeric>
            <span style={{ color: away.color }}>{away.abbr}</span>
            <span className="font-normal text-muted-foreground"> @ </span>
            <span style={{ color: home.color }}>{home.abbr}</span>
          </span>
          {holiday && <HolidayTag label={game.holiday_label} />}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Score game={game} />
          <StatusChip game={game} />
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <GameDate game={game} />
        {game.network && (
          <>
            <span className="text-muted-foreground" aria-hidden>
              ·
            </span>
            <span className="text-muted-foreground">{game.network}</span>
          </>
        )}
      </div>

      <div className="mt-1.5 text-xs">
        <PayoutPair game={game} config={config} />
      </div>
    </Link>
  );
}

export default async function SchedulePage() {
  const [games, config] = await Promise.all([getPublicGames(), getConfig()]);

  const byWeek = new Map<number, PublicGame[]>();
  for (const game of games) {
    const list = byWeek.get(game.week);
    if (list) list.push(game);
    else byWeek.set(game.week, [game]);
  }
  const weeks = Array.from(byWeek.entries()).sort((a, b) => a[0] - b[0]);
  const hasHoliday = games.some((g) => g.game_type === "holiday");

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Schedule</h1>
        <p className="text-sm text-muted-foreground" data-numeric>
          {games.length} games ·{" "}
          {fmtUsd(seasonPayoutTotalCents(games, config))} in payouts · all
          times ET
        </p>
        {hasHoliday && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="h-3.5 w-1 shrink-0 rounded-full bg-holiday"
              aria-hidden
            />
            Holiday games pay{" "}
            <span className="font-medium text-halftime" data-numeric>
              {fmtUsd(config.holiday_halftime_cents)}
            </span>{" "}
            /{" "}
            <span className="font-medium text-final" data-numeric>
              {fmtUsd(config.holiday_final_cents)}
            </span>
          </p>
        )}
      </header>

      {games.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-16 text-center">
          <CalendarDays
            className="mx-auto size-10 text-muted-foreground/50"
            aria-hidden
          />
          <p className="mt-4 text-base font-medium">No games scheduled</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The 2026 slate lands here as soon as it is set.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile: stacked cards under a week label */}
          <div className="space-y-5 md:hidden">
            {weeks.map(([week, weekGames]) => (
              <section key={week} className="space-y-2">
                <h2
                  className="px-1 text-2xs font-semibold tracking-widest text-muted-foreground uppercase"
                  data-numeric
                >
                  Week {week}
                </h2>
                {weekGames.map((game) => (
                  <MobileCard key={game.id} game={game} config={config} />
                ))}
              </section>
            ))}
          </div>

          {/* Desktop: one dense list with week header rows */}
          <div className="hidden overflow-hidden rounded-lg border border-border bg-surface md:block">
            <div className="divide-y divide-border">
              {weeks.map(([week, weekGames]) => (
                <Fragment key={week}>
                  <div
                    className="bg-surface-2/60 px-4 py-1.5 text-2xs font-semibold tracking-widest text-muted-foreground uppercase"
                    data-numeric
                  >
                    Week {week}
                  </div>
                  {weekGames.map((game) => (
                    <DesktopRow key={game.id} game={game} config={config} />
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
