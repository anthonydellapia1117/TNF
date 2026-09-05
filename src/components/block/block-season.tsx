import Link from "next/link";
import { StatusChip } from "@/components/grid/status-chip";
import { fmtDateET, fmtUsd } from "@/lib/format";
import { teamInfo } from "@/lib/nfl";
import {
  blockDigits,
  gameCode,
  isPermutation,
  payoutCents,
  winningBlock,
} from "@/lib/pool";
import { cn } from "@/lib/utils";
import type { PoolConfig, PublicGame } from "@/lib/types";

/** The block the live score points at, or null when nothing is live. */
function liveLeader(game: PublicGame): number | null {
  if (!isPermutation(game.row_digits) || !isPermutation(game.col_digits)) {
    return null;
  }
  if (
    game.final_home !== null ||
    game.live_home === null ||
    game.live_away === null
  ) {
    return null;
  }
  return winningBlock(
    game.row_digits,
    game.col_digits,
    game.live_home,
    game.live_away,
  );
}

function DigitChip({
  label,
  digit,
}: {
  label: "HOME" | "AWAY";
  digit: number | null;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-2xs",
        digit === null ? "text-muted-foreground/50" : "text-muted-foreground",
      )}
      data-numeric
    >
      {label}
      <span className={cn("font-semibold", digit !== null && "text-foreground")}>
        {digit ?? "?"}
      </span>
    </span>
  );
}

function GameRow({
  game,
  n,
  config,
}: {
  game: PublicGame;
  n: number;
  config: PoolConfig;
}) {
  const away = teamInfo(game.away_team);
  const home = teamInfo(game.home_team);
  const digits = blockDigits(n, game.row_digits, game.col_digits);
  const wonHalf = game.halftime_block === n;
  const wonFinal = game.final_block === n;
  const leading = liveLeader(game) === n;

  return (
    <Link
      href={`/grid?g=${game.game_no}`}
      className={cn(
        "flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2.5 transition-colors duration-150 hover:bg-surface-2 sm:min-h-10 sm:flex-row sm:items-center sm:gap-3 sm:py-1.5",
        wonFinal && "border-final/40",
        !wonFinal && wonHalf && "border-halftime/40",
        leading && "border-live/50",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap sm:gap-x-3">
        <span
          className={cn(
            "w-8 shrink-0 text-2xs font-semibold",
            game.game_type === "holiday" ? "text-holiday" : "text-muted-foreground",
          )}
          title={game.holiday_label ?? undefined}
          data-numeric
        >
          {gameCode(game.game_no)}
        </span>
        <span className="text-sm font-semibold whitespace-nowrap">
          <span style={{ color: away.color }}>{away.abbr}</span>
          <span className="font-normal text-muted-foreground"> @ </span>
          <span style={{ color: home.color }}>{home.abbr}</span>
        </span>
        <span
          className="text-xs whitespace-nowrap text-muted-foreground"
          data-numeric
        >
          {fmtDateET(game.kickoff_at)}
        </span>
        <StatusChip game={game} />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <DigitChip label="HOME" digit={digits?.home ?? null} />
        <DigitChip label="AWAY" digit={digits?.away ?? null} />
        {wonHalf && (
          <span
            className="inline-flex items-center rounded-full border border-halftime/50 bg-halftime/15 px-2 py-0.5 text-2xs font-semibold tracking-wide whitespace-nowrap text-halftime"
            data-numeric
          >
            HALF · {fmtUsd(payoutCents(game.game_type, "halftime", config))}
          </span>
        )}
        {wonFinal && (
          <span
            className="inline-flex items-center rounded-full border border-final/50 bg-final/15 px-2 py-0.5 text-2xs font-semibold tracking-wide whitespace-nowrap text-final"
            data-numeric
          >
            FINAL · {fmtUsd(payoutCents(game.game_type, "final", config))}
          </span>
        )}
        {leading && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-live/60 bg-live/15 px-2 py-0.5 text-2xs font-semibold tracking-wide whitespace-nowrap text-live">
            <span className="relative flex size-1.5" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-live" />
            </span>
            LEADING IF IT ENDED NOW
          </span>
        )}
      </div>
    </Link>
  );
}

/** Every game of the season, one row per game, from block n's point of view. */
export function BlockSeason({
  games,
  n,
  config,
}: {
  games: PublicGame[];
  n: number;
  config: PoolConfig;
}) {
  if (games.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          The schedule isn&apos;t posted yet - 23 Thursday nights are coming.
        </p>
      </section>
    );
  }

  const ordered = [...games].sort((a, b) => a.game_no - b.game_no);

  return (
    <section className="space-y-2">
      <h2 className="flex items-baseline justify-between text-2xs font-semibold tracking-widest text-muted-foreground uppercase">
        <span>Season</span>
        <span data-numeric>{ordered.length} games</span>
      </h2>
      <ul className="space-y-1.5">
        {ordered.map((game) => (
          <li key={game.id}>
            <GameRow game={game} n={n} config={config} />
          </li>
        ))}
      </ul>
    </section>
  );
}
