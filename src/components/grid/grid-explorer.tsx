"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { matchupLabel } from "@/lib/nfl";
import {
  matchBlocks,
  matchDigits,
  matchSummary,
  normalizeQuery,
} from "@/lib/grid-search";
import type { PoolConfig, PublicBlock, PublicGame } from "@/lib/types";
import { BlocksGrid, type GridMode } from "./blocks-grid";
import { GameHeader } from "./game-header";
import { WinnerPanel } from "./winner-panel";

const MODE_KEY = "tnf-grid-mode";
/** Per-block lines under the search only while the list is short. */
const MAX_DETAIL = 10;

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
  // The name search and the tapped block live here, above the game and the
  // view, so switching either keeps them (Part Q).
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

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

  const matches = useMemo(() => matchBlocks(blocks, query), [blocks, query]);
  const searching = normalizeQuery(query) !== "";
  const nameOf = (n: number) =>
    blocks.find((b) => b.block_number === n)?.display_name ?? null;
  const awayShort = game.away_team.split(" ").pop();
  const homeShort = game.home_team.split(" ").pop();
  const digitsText = (n: number) => {
    const d = matchDigits(n, game);
    return d
      ? `${awayShort} ${d.away}, ${homeShort} ${d.home}`
      : "digits not drawn yet";
  };
  const clearSearch = () => {
    setQuery("");
    setSelected(null);
  };

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

      {/* Find your name (Part Q): live, any part of the name the board
          shows, any case. 16px text so iPhone Safari does not zoom. */}
      <div className="sticky top-12 z-30 -mx-1 space-y-1.5 bg-background/95 px-1 py-1.5 backdrop-blur">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your name"
            aria-label="Search your name"
            className="h-11 w-full rounded-md border border-border bg-surface pr-11 pl-9 text-foreground placeholder:text-muted-foreground focus:border-pool-accent focus:outline-none"
            style={{ fontSize: "16px" }}
          />
          {query !== "" && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
        {selected !== null && (
          <div
            className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
            data-testid="selected-block"
          >
            <p className="min-w-0">
              <span className="font-semibold" data-numeric>
                Block {selected}
              </span>
              {" · "}
              <span className="break-words">{nameOf(selected) ?? "Open"}</span>
              <span
                className="block text-xs text-muted-foreground"
                data-numeric
              >
                {digitsText(selected)}
              </span>
            </p>
            <Link
              href={`/block/${selected}`}
              className="shrink-0 text-xs font-medium text-pool-accent hover:underline"
            >
              Block page
            </Link>
          </div>
        )}
      </div>

      {searching && (
        <div
          aria-live="polite"
          className="text-sm"
          data-testid="search-summary"
        >
          <p className="font-semibold">{matchSummary(matches)}</p>
          {matches.length > 0 && matches.length <= MAX_DETAIL && (
            <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
              {matches.map((n) => (
                <li key={n} data-numeric>
                  <span className="font-semibold text-foreground">{n}</span>
                  {" · "}
                  {nameOf(n)}
                  {" · "}
                  {digitsText(n)}
                </li>
              ))}
            </ul>
          )}
          {matches.length > MAX_DETAIL && (
            <p className="text-xs text-muted-foreground">
              Keep typing to narrow it down.
            </p>
          )}
        </div>
      )}

      <BlocksGrid
        game={game}
        blocks={blocks}
        config={config}
        mode={mode}
        matches={matches}
        selected={selected}
        onSelect={(n) => setSelected((cur) => (cur === n ? null : n))}
      />

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
