// Score patterns: the home–away last-digit pairs that keep coming up.
//
// A PAIR, never a block. Digits are drawn independently for every game, so
// "home 7, away 0" lands on a different number each week — the pair is the
// thing that recurs, and it is the thing a fan can actually reason about.
import type { HotCell } from "@/lib/fan-stats";

export function HotCells({
  cells,
  gamesPlayed,
}: {
  cells: HotCell[];
  gamesPlayed: number;
}) {
  if (cells.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {gamesPlayed === 0
          ? "Nothing yet — after a few games this shows which home–away digit pairs keep landing."
          : "Not enough scores yet to see a pattern."}
      </p>
    );
  }

  const most = cells[0].hits;

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {cells.map((c) => (
          <li
            key={`${c.homeDigit}-${c.awayDigit}`}
            className="flex items-center gap-3"
          >
            <span
              className="flex shrink-0 items-center gap-1 text-sm font-semibold"
              data-numeric
            >
              <span className="inline-flex size-6 items-center justify-center rounded border border-border bg-surface-2">
                {c.homeDigit}
              </span>
              <span className="text-2xs font-normal text-muted-foreground">
                –
              </span>
              <span className="inline-flex size-6 items-center justify-center rounded border border-border bg-surface-2">
                {c.awayDigit}
              </span>
            </span>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
              <span
                className="block h-full rounded-full bg-pool-accent"
                style={{ width: `${most > 0 ? (c.hits / most) * 100 : 0}%` }}
              />
            </span>
            <span
              className="w-12 shrink-0 text-right text-2xs text-muted-foreground"
              data-numeric
            >
              {c.hits} {c.hits === 1 ? "hit" : "hits"}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-2xs text-muted-foreground">
        Home digit first. The digits are redrawn every game, so a pair lands on
        a different block each week.
      </p>
    </div>
  );
}
