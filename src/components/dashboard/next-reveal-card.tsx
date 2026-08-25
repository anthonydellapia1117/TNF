"use client";

// The NEXT REVEAL card: one card, four states, always the most relevant
// thing at this moment — reveal countdown, kickoff countdown, the live
// game, or the last winner; season summary once there's no next game.
// Ticks every second like the deadline countdown, and refreshes the route
// once when a countdown crosses zero so the state flips without a reload.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Radio, Timer, Trophy } from "lucide-react";
import { fmtKickoffET, fmtUsd } from "@/lib/format";
import { teamInfo } from "@/lib/nfl";
import { gameCode } from "@/lib/pool";
import {
  revealCardState,
  seasonSummary,
  type RevealCardState,
} from "@/lib/next-reveal";
import type { PublicBlock, PublicGame, PublicPayout } from "@/lib/types";

function abbr(team: string): string {
  return teamInfo(team).abbr;
}

/** Compact "3d 04:12:08" countdown string. */
function countdownText(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const days = Math.floor(total / 86_400);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hms = `${pad(Math.floor((total % 86_400) / 3_600))}:${pad(Math.floor((total % 3_600) / 60))}:${pad(total % 60)}`;
  return days > 0 ? `${days}d ${hms}` : hms;
}

function Ticker({ targetISO, label }: { targetISO: string; label: string }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const refreshed = useRef(false);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [targetISO]);

  const target = new Date(targetISO).getTime();
  const left = target - now;

  // The moment the clock crosses zero, pull fresh server data once so the
  // card flips state (reveal → numbers, kickoff → live) without a reload.
  useEffect(() => {
    if (left <= 0 && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [left, router]);

  if (Number.isNaN(target)) return null;
  return (
    <p
      className="mt-2 text-2xl font-semibold tabular-nums"
      role="timer"
      aria-label={label}
      data-numeric
      suppressHydrationWarning
    >
      {left <= 0 ? "any moment" : countdownText(left)}
    </p>
  );
}

function Label({
  icon,
  children,
  className,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`flex items-center gap-1.5 text-2xs font-semibold tracking-widest uppercase ${className ?? "text-muted-foreground"}`}
    >
      {icon}
      {children}
    </p>
  );
}

function Matchup({ game }: { game: PublicGame }) {
  return (
    <p className="mt-1 text-xs text-muted-foreground" data-numeric>
      {gameCode(game.game_no)} · {abbr(game.away_team)} at {abbr(game.home_team)}
    </p>
  );
}

export function NextRevealCard({
  games,
  payouts,
  blocks,
}: {
  games: PublicGame[];
  payouts: PublicPayout[];
  blocks: PublicBlock[];
}) {
  // Server and client agree on first paint by deciding the state from the
  // serialized data; the ticking inside is hydration-safe.
  const state: RevealCardState = revealCardState(games, Date.now());

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <CardBody state={state} games={games} payouts={payouts} blocks={blocks} />
    </div>
  );
}

function CardBody({
  state,
  games,
  payouts,
  blocks,
}: {
  state: RevealCardState;
  games: PublicGame[];
  payouts: PublicPayout[];
  blocks: PublicBlock[];
}) {
  switch (state.kind) {
    case "next_reveal":
      return (
        <>
          <Label icon={<CalendarClock className="size-3" aria-hidden />}>
            Next reveal
          </Label>
          <Matchup game={state.game} />
          {state.revealAtISO ? (
            <>
              <Ticker
                targetISO={state.revealAtISO}
                label="Time until the numbers drop"
              />
              <p className="mt-1 text-2xs text-muted-foreground" data-numeric>
                Numbers drop {fmtKickoffET(state.revealAtISO)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Numbers drop before kickoff — date TBD.
            </p>
          )}
        </>
      );

    case "numbers_live":
      return (
        <>
          <Label
            icon={<Radio className="size-3" aria-hidden />}
            className="text-emerald-400"
          >
            Your numbers are live
          </Label>
          <Matchup game={state.game} />
          {state.game.kickoff_at ? (
            <>
              <Ticker
                targetISO={state.game.kickoff_at}
                label="Time until kickoff"
              />
              <p className="mt-1 text-2xs text-muted-foreground" data-numeric>
                Kickoff {fmtKickoffET(state.game.kickoff_at)} ·{" "}
                <Link href="/grid" className="text-pool-accent hover:text-foreground">
                  see the grid
                </Link>
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Kickoff time TBD —{" "}
              <Link href="/grid" className="text-pool-accent hover:text-foreground">
                see the grid
              </Link>
            </p>
          )}
        </>
      );

    case "live_now": {
      const g = state.game;
      const away = teamInfo(g.away_team);
      const home = teamInfo(g.home_team);
      const hasScore = g.live_home !== null && g.live_away !== null;
      const leader =
        state.leaderBlock !== null
          ? blocks.find((b) => b.block_number === state.leaderBlock)
          : undefined;
      return (
        <>
          <Label
            icon={
              <span className="relative flex size-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-live" />
              </span>
            }
            className="text-live"
          >
            Live now
          </Label>
          {hasScore ? (
            <p className="mt-2 text-2xl font-semibold" data-numeric>
              <span style={{ color: away.color }}>{abbr(g.away_team)}</span>{" "}
              {g.live_away}
              <span className="mx-1.5 text-sm font-normal text-muted-foreground">
                at
              </span>
              <span style={{ color: home.color }}>{abbr(g.home_team)}</span>{" "}
              {g.live_home}
            </p>
          ) : (
            <p className="mt-2 text-lg font-semibold">
              <span style={{ color: away.color }}>{abbr(g.away_team)}</span>
              <span className="mx-1.5 text-sm font-normal text-muted-foreground">
                at
              </span>
              <span style={{ color: home.color }}>{abbr(g.home_team)}</span>
            </p>
          )}
          <p className="mt-1 text-2xs text-muted-foreground" data-numeric>
            {state.leaderBlock !== null ? (
              <>
                Block {state.leaderBlock} leads
                {leader?.display_name ? ` · ${leader.display_name}` : ""} ·{" "}
              </>
            ) : null}
            <Link href="/grid" className="text-pool-accent hover:text-foreground">
              watch the grid
            </Link>
          </p>
        </>
      );
    }

    case "last_winner": {
      const g = state.lastGame;
      const win = payouts
        .filter((p) => p.game_id === g.id)
        .sort((a) => (a.payout_type === "final" ? -1 : 1))[0];
      return (
        <>
          <Label
            icon={<Trophy className="size-3" aria-hidden />}
            className="text-final"
          >
            Last winner
          </Label>
          {win ? (
            <>
              <p className="mt-2 text-lg font-semibold" data-numeric>
                Block {win.block_number} · {fmtUsd(win.amount_cents)}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground" data-numeric>
                {gameCode(g.game_no)} final
                {win.display_name ? ` · ${win.display_name}` : ""}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground" data-numeric>
              {gameCode(g.game_no)} is final — result under review.
            </p>
          )}
          {state.nextGame && (
            <p className="mt-1 text-2xs text-muted-foreground" data-numeric>
              Next game {gameCode(state.nextGame.game_no)}{" "}
              {fmtKickoffET(state.nextGame.kickoff_at)}
            </p>
          )}
        </>
      );
    }

    case "season_summary": {
      const s = seasonSummary(games, payouts);
      return (
        <>
          <Label
            icon={<Timer className="size-3" aria-hidden />}
            className="text-final"
          >
            Season complete
          </Label>
          <p className="mt-2 text-2xl font-semibold" data-numeric>
            {s.gamesPlayed}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              games played
            </span>
          </p>
          <p className="mt-1 text-2xs text-muted-foreground" data-numeric>
            {fmtUsd(s.totalWonCents)} won
            {s.topWinner
              ? ` · top winner ${s.topWinner.name} (${fmtUsd(s.topWinner.cents)})`
              : ""}
          </p>
        </>
      );
    }
  }
}
