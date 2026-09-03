"use client";

// The next holiday game. Holiday finals pay more than a regular week, which
// is worth knowing in advance — and unlike the rest of the season stats this
// card has real content from day one.

import { useEffect, useState } from "react";
import { PartyPopper } from "lucide-react";
import { fmtDateET, fmtUsd } from "@/lib/format";
import { matchupLabel } from "@/lib/nfl";
import type { HolidayNext } from "@/lib/fan-stats";

/** "84 days" / "6 days" / "tomorrow" / "today". Whole days, ET-agnostic. */
function daysAway(iso: string, nowMs: number): string {
  const days = Math.ceil((new Date(iso).getTime() - nowMs) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `${days} days`;
}

export function HolidayCard({ holiday }: { holiday: HolidayNext | null }) {
  // Rendered on the server first; the client recomputes so the count is not
  // frozen at build time.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const kickoff = holiday?.game.kickoff_at ?? null;
  if (!holiday || kickoff === null) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="flex items-center gap-1.5 text-2xs font-semibold tracking-widest text-muted-foreground uppercase">
          <PartyPopper className="size-3" aria-hidden />
          Holiday games
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          All the holiday games are behind us for this season.
        </p>
      </div>
    );
  }

  const g = holiday.game;

  return (
    <div className="rounded-lg border border-holiday/40 bg-surface p-4">
      <p className="flex items-center gap-1.5 text-2xs font-semibold tracking-widest text-holiday uppercase">
        <PartyPopper className="size-3" aria-hidden />
        {g.holiday_label ?? "Holiday game"}
      </p>
      <p className="mt-2 text-2xl font-semibold" data-numeric>
        {daysAway(kickoff, nowMs)}
      </p>
      <p className="mt-1 text-2xs text-muted-foreground" data-numeric>
        {matchupLabel(g.away_team, g.home_team)} · {fmtDateET(kickoff)}
      </p>
      {holiday.finalPremiumCents > 0 && (
        <p className="mt-1.5 text-2xs text-holiday" data-numeric>
          Final pays {fmtUsd(holiday.finalPremiumCents)} more than a regular
          week
        </p>
      )}
      {holiday.remaining > 1 && (
        <p className="mt-0.5 text-2xs text-muted-foreground" data-numeric>
          {holiday.remaining} holiday games still ahead
        </p>
      )}
    </div>
  );
}
