import Link from "next/link";
import { cn } from "@/lib/utils";
import { gameCode } from "@/lib/pool";
import { matchupLabel } from "@/lib/nfl";
import type { PublicGame } from "@/lib/types";

// C3: the whole season at a glance - one segment per game, colored by
// state, current game marked, click to jump to that game's card.

function segmentClass(g: PublicGame): string {
  if (g.status === "final") return "bg-final/70";
  if (g.status === "in_progress" || g.status === "halftime")
    return "bg-live live-pulse";
  if (g.digits_published_at) return "bg-emerald-500/70";
  if (g.digits_assigned) return "bg-halftime/70";
  if (!g.date_confirmed) return "bg-transparent border border-dashed border-halftime/60";
  return "bg-surface-2 border border-border";
}

export function SeasonStrip({
  games,
  currentGameNo,
}: {
  games: PublicGame[];
  currentGameNo: number | null;
}) {
  return (
    <div>
      <div className="flex items-end gap-[3px]" aria-label="Season progress">
        {games.map((g) => (
          <Link
            key={g.game_no}
            href={`#g${g.game_no}`}
            title={`${gameCode(g.game_no)} · ${matchupLabel(g.away_team, g.home_team)}`}
            aria-label={`Jump to ${gameCode(g.game_no)}, ${matchupLabel(g.away_team, g.home_team)}`}
            className={cn(
              "h-3 min-w-0 flex-1 rounded-[2px] transition-transform duration-150 hover:scale-y-125",
              segmentClass(g),
              g.game_no === currentGameNo &&
                "h-4 ring-2 ring-pool-accent ring-offset-1 ring-offset-background",
              g.game_type === "holiday" && "outline outline-1 outline-holiday/50",
            )}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-[2px] border border-dashed border-halftime/60" aria-hidden />
          date TBD
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-[2px] border border-border bg-surface-2" aria-hidden />
          scheduled
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-[2px] bg-emerald-500/70" aria-hidden />
          digits live
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-[2px] bg-live" aria-hidden />
          in progress
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-[2px] bg-final/70" aria-hidden />
          final
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-[2px] outline outline-1 outline-holiday/60" aria-hidden />
          holiday
        </span>
      </div>
    </div>
  );
}
