// Close calls: the blocks that were one point from a win. The near-miss a
// player actually feels - "one more field goal and that was mine."
//
// Pre-season this shows what it will show rather than an empty box: there is
// nothing honest to put in it until a game has been scored.
import Link from "next/link";
import { Crosshair } from "lucide-react";
import { gameCode } from "@/lib/pool";
import type { CloseCall } from "@/lib/fan-stats";

export function CloseCalls({
  calls,
  gamesPlayed,
}: {
  calls: CloseCall[];
  gamesPlayed: number;
}) {
  if (calls.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {gamesPlayed === 0
          ? "Nothing yet - this fills in the first time a score lands one point off somebody's block."
          : "No near misses so far. Every hit has been clean."}
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {calls.map((c) => (
        <li key={`${c.gameNo}-${c.payoutType}-${c.blockNumber}`}>
          <Link
            href={`/block/${c.blockNumber}`}
            className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2 transition-colors duration-150 hover:border-pool-accent/60"
          >
            <Crosshair
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span
              className="w-9 shrink-0 text-xs font-semibold text-muted-foreground"
              data-numeric
            >
              {gameCode(c.gameNo)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className="font-semibold" data-numeric>
                {c.name}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · block {c.blockNumber}
              </span>
            </span>
            <span
              className="shrink-0 text-2xs whitespace-nowrap text-muted-foreground"
              data-numeric
            >
              {c.team.split(" ").pop()} {c.delta === 1 ? "+1" : "−1"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
