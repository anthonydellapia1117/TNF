import { fmtKickoffET, fmtUsd } from "@/lib/format";
import { gameCode, payoutCents } from "@/lib/pool";
import { teamInfo } from "@/lib/nfl";
import type { PoolConfig, PublicGame } from "@/lib/types";
import { ScoreDigits } from "./score-digits";
import { StatusChip } from "./status-chip";

function displayScores(game: PublicGame): {
  away: number | null;
  home: number | null;
  label: string | null;
} {
  if (game.final_home !== null) {
    return { away: game.final_away, home: game.final_home, label: "FINAL" };
  }
  if (game.live_home !== null) {
    return { away: game.live_away, home: game.live_home, label: "LIVE" };
  }
  if (game.halftime_home !== null) {
    return { away: game.halftime_away, home: game.halftime_home, label: "HALFTIME" };
  }
  return { away: null, home: null, label: null };
}

export function GameHeader({
  game,
  config,
}: {
  game: PublicGame;
  config: PoolConfig;
}) {
  const away = teamInfo(game.away_team);
  const home = teamInfo(game.home_team);
  const scores = displayScores(game);
  const half = payoutCents(game.game_type, "halftime", config);
  const fin = payoutCents(game.game_type, "final", config);

  return (
    <div className="space-y-4 text-center">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground" data-numeric>
          {gameCode(game.game_no)}
        </span>
        {game.holiday_label && (
          <>
            <span aria-hidden>·</span>
            <span className="font-semibold tracking-wide text-holiday uppercase">
              {game.holiday_label}
            </span>
          </>
        )}
        <span aria-hidden>·</span>
        <span data-numeric>{fmtKickoffET(game.kickoff_at)}</span>
        {game.network && (
          <>
            <span aria-hidden>·</span>
            <span>{game.network}</span>
          </>
        )}
        <StatusChip game={game} />
      </div>

      <div className="mx-auto grid max-w-2xl grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-4">
        <div className="min-w-0">
          <p
            className="truncate text-sm font-semibold tracking-wide uppercase sm:text-lg"
            style={{ color: away.color }}
            title={game.away_team}
          >
            {game.away_team}
          </p>
          <ScoreDigits
            score={scores.away}
            className="text-3xl sm:text-4xl"
          />
          <p className="text-2xs tracking-widest text-muted-foreground uppercase">
            away
          </p>
        </div>
        <div className="pt-1 text-sm text-muted-foreground sm:pt-2">at</div>
        <div className="min-w-0">
          <p
            className="truncate text-sm font-semibold tracking-wide uppercase sm:text-lg"
            style={{ color: home.color }}
            title={game.home_team}
          >
            {game.home_team}
          </p>
          <ScoreDigits
            score={scores.home}
            className="text-3xl sm:text-4xl"
          />
          <p className="text-2xs tracking-widest text-muted-foreground uppercase">
            home
          </p>
        </div>
      </div>

      {game.final_home !== null && game.halftime_home !== null && (
        <p className="text-2xs text-muted-foreground" data-numeric>
          Halftime: {game.away_team.split(" ").at(-1)} {game.halftime_away} ·{" "}
          {game.home_team.split(" ").at(-1)} {game.halftime_home}
        </p>
      )}

      <p className="text-sm text-muted-foreground" data-numeric>
        Halftime <span className="font-medium text-halftime">{fmtUsd(half)}</span>
        <span aria-hidden> · </span>
        Final <span className="font-medium text-final">{fmtUsd(fin)}</span>
      </p>
    </div>
  );
}
