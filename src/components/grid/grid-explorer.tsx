"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { matchupLabel } from "@/lib/nfl";
import type { PoolConfig, PublicBlock, PublicGame } from "@/lib/types";
import { BlocksGrid, type GridMode } from "./blocks-grid";
import { GameHeader } from "./game-header";
import { WinnerPanel } from "./winner-panel";

const MODE_KEY = "tnf-grid-mode";

export function GridExplorer({
  games,
  blocks,
  config,
  initialGameNo,
}: {
  games: PublicGame[];
  blocks: PublicBlock[];
  config: PoolConfig;
  initialGameNo: number;
}) {
  const router = useRouter();
  const [gameNo, setGameNo] = useState(initialGameNo);
  const [mode, setMode] = useState<GridMode>("fit");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MODE_KEY);
      if (stored === "comfortable" || stored === "fit") setMode(stored);
    } catch {
      // storage unavailable - keep the default
    }
  }, []);

  const setModePersist = (m: GridMode) => {
    setMode(m);
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      // best effort
    }
  };

  const weeks = useMemo(
    () => [...new Set(games.map((g) => g.week))].sort((a, b) => a - b),
    [games],
  );
  const game = games.find((g) => g.game_no === gameNo) ?? games[0];
  const weekGames = games.filter((g) => g.week === game.week);

  const selectGame = (n: number) => {
    setGameNo(n);
    window.history.replaceState(null, "", `/grid?g=${n}`);
  };

  const selectWeek = (w: number) => {
    const first = games.find((g) => g.week === w);
    if (first) selectGame(first.game_no);
  };

  // While the selected game is live, keep the public grid fresh.
  const live = game.status === "in_progress" || game.status === "halftime";
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 20000);
    return () => clearInterval(t);
  }, [live, router]);

  return (
    <div className="space-y-5">
      {/* Week tabs: horizontally scrollable, current week auto-selected */}
      <div
        className="flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Week"
      >
        {weeks.map((w) => {
          const active = w === game.week;
          const hasHoliday = games.some(
            (g) => g.week === w && g.game_type === "holiday",
          );
          return (
            <button
              key={w}
              role="tab"
              aria-selected={active}
              onClick={() => selectWeek(w)}
              className={cn(
                "shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
                active
                  ? "border-pool-accent/60 bg-pool-accent/15 text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground",
                hasHoliday && !active && "border-holiday/40",
              )}
              data-numeric
            >
              W{w}
            </button>
          );
        })}
      </div>

      {/* Game sub-tabs for multi-game weeks (Thanksgiving has three) */}
      {weekGames.length > 1 && (
        <div
          className="flex gap-1 overflow-x-auto"
          role="tablist"
          aria-label="Game"
        >
          {weekGames.map((g) => (
            <button
              key={g.game_no}
              role="tab"
              aria-selected={g.game_no === game.game_no}
              onClick={() => selectGame(g.game_no)}
              className={cn(
                "shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
                g.game_no === game.game_no
                  ? "border-holiday/60 bg-holiday/15 text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground",
              )}
            >
              {matchupLabel(g.away_team, g.home_team)}
            </button>
          ))}
        </div>
      )}

      <GameHeader game={game} config={config} />

      {/* Fit / comfortable toggle (spec 4.1 responsive) */}
      <div className="flex items-center justify-end gap-1">
        {(["fit", "comfortable"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setModePersist(m)}
            aria-pressed={mode === m}
            className={cn(
              "rounded-md border px-2.5 py-1 text-2xs font-medium capitalize transition-colors duration-150",
              mode === m
                ? "border-pool-accent/60 bg-pool-accent/15 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <BlocksGrid game={game} blocks={blocks} config={config} mode={mode} />

      {!game.digits_published_at && (
        <p className="text-center text-xs text-muted-foreground">
          Digits publish before kickoff - every ? becomes a number, freshly
          randomized for this game.
        </p>
      )}

      <WinnerPanel game={game} blocks={blocks} config={config} />
    </div>
  );
}
