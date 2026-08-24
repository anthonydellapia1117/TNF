"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import {
  echoConfirm,
  gameCode,
  isPermutation,
  payoutCents,
  winningBlock,
} from "@/lib/pool";
import { matchupLabel, teamInfo } from "@/lib/nfl";
import {
  clearLiveScore,
  scoreGame,
  setLiveScore,
  type ScoreResult,
} from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BlocksGrid } from "@/components/grid/blocks-grid";
import type { AdminGame, PoolConfig, PublicBlock, PublicGame } from "@/lib/types";

export function ScoreClient({
  games,
  blocks,
  config,
}: {
  games: AdminGame[];
  blocks: PublicBlock[];
  config: PoolConfig;
}) {
  const router = useRouter();
  const scorable = games.filter((g) => g.digits_published_at !== null);
  const [gameId, setGameId] = useState<string>(scorable[0]?.id ?? "");
  const game = games.find((g) => g.id === gameId) ?? null;

  const [type, setType] = useState<"halftime" | "final">("halftime");
  const [awayStr, setAwayStr] = useState("");
  const [homeStr, setHomeStr] = useState("");
  const [liveMode, setLiveMode] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const away = /^\d+$/.test(awayStr) ? parseInt(awayStr, 10) : null;
  const home = /^\d+$/.test(homeStr) ? parseInt(homeStr, 10) : null;
  const valid = away !== null && home !== null && game !== null;

  const published =
    game !== null &&
    isPermutation(game.row_digits) &&
    isPermutation(game.col_digits);

  const previewBlock =
    valid && published
      ? winningBlock(
          game.row_digits as number[],
          game.col_digits as number[],
          home,
          away,
        )
      : null;
  const previewOwner =
    previewBlock !== null
      ? blocks.find((b) => b.block_number === previewBlock)
      : null;

  // The live-highlight: feed the typed score into the real public grid as a
  // provisional live score so the winning cell pulses exactly as it will
  // for the players.
  const previewGame: PublicGame | null = useMemo(() => {
    if (!game) return null;
    const base: PublicGame = {
      ...game,
      digits_assigned: game.digits_assigned_at !== null,
    };
    if (valid && game.final_home === null) {
      return { ...base, live_home: home, live_away: away };
    }
    return base;
  }, [game, valid, home, away]);

  if (scorable.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl">Score</h1>
        <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
          No game has published digits yet. Scoring is refused by the database
          before digits publish — assign and publish on the Digits screen
          first.
        </div>
      </div>
    );
  }

  const amount = game
    ? payoutCents(game.game_type, type, config)
    : 0;

  const submitScore = () => {
    if (!game || away === null || home === null) return;
    startTransition(async () => {
      const res = await scoreGame({ gameId: game.id, type, away, home });
      setConfirming(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const r = res.data as ScoreResult;
      if (r.review) {
        toast.warning(
          `Block ${r.block} is ${r.winner_status} — score recorded, NO payout created. Review flagged.`,
          { duration: 8000 },
        );
      } else {
        toast.success(
          `Block ${r.block} — ${r.winner_name ?? "?"} wins ${fmtUsd(r.amount_cents)}. Payout created as owed.`,
          { duration: 8000 },
        );
      }
      router.refresh();
    });
  };

  const pushLive = () => {
    if (!game || away === null || home === null) return;
    startTransition(async () => {
      const res = await setLiveScore({ gameId: game.id, away, home });
      if (res.ok) {
        toast.success("Live score pushed — the public grid shows IF IT ENDED NOW.");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const clearLive = () => {
    if (!game) return;
    startTransition(async () => {
      const res = await clearLiveScore(game.id);
      if (res.ok) {
        toast.success("Live score cleared.");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const awayInfo = game ? teamInfo(game.away_team) : null;
  const homeInfo = game ? teamInfo(game.home_team) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl">Score</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Every score echo-confirms in away-at-home order before it touches the
          database. The app never pays anyone — it records who is owed.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="game">Game</Label>
            <select
              id="game"
              value={gameId}
              onChange={(e) => {
                setGameId(e.target.value);
                setAwayStr("");
                setHomeStr("");
              }}
              className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
            >
              {scorable.map((g) => (
                <option key={g.id} value={g.id}>
                  {gameCode(g.game_no)} · {matchupLabel(g.away_team, g.home_team)}
                  {g.status === "final" ? " (final)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
            {(["halftime", "final"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                aria-pressed={type === t}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors duration-150",
                  type === t
                    ? t === "final"
                      ? "bg-final/20 text-final"
                      : "bg-halftime/20 text-halftime"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t} · {fmtUsd(payoutCents(game?.game_type ?? "regular", t, config))}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="away"
                className="block truncate"
                style={{ color: awayInfo?.color }}
              >
                {game?.away_team ?? "Away"} (away)
              </Label>
              <Input
                id="away"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                value={awayStr}
                onChange={(e) => setAwayStr(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  // F7: Enter walks away → home → confirm.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    document.getElementById("home")?.focus();
                  }
                }}
                className="h-14 text-center !text-2xl tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="home"
                className="block truncate"
                style={{ color: homeInfo?.color }}
              >
                {game?.home_team ?? "Home"} (home)
              </Label>
              <Input
                id="home"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                value={homeStr}
                onChange={(e) => setHomeStr(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid && published) {
                    e.preventDefault();
                    setConfirming(true);
                  }
                }}
                className="h-14 text-center !text-2xl tabular-nums"
              />
            </div>
          </div>

          {previewBlock !== null && (
            <div className="rounded-lg border border-live/40 bg-live/10 px-3 py-2.5 text-sm">
              <span className="font-semibold" data-numeric>
                Block {previewBlock}
              </span>{" "}
              would win —{" "}
              {previewOwner?.display_name ? (
                <span>{previewOwner.display_name}</span>
              ) : (
                <span className="text-halftime">
                  {previewOwner?.status ?? "available"} (no payout — review)
                </span>
              )}
              {previewOwner?.status === "reserved" && (
                <span className="text-halftime"> — reserved, not assigned: no payout</span>
              )}
            </div>
          )}

          <Button
            className="w-full"
            size="lg"
            disabled={!valid || pending || !published}
            onClick={() => setConfirming(true)}
          >
            Score {type} · {fmtUsd(amount)}
          </Button>

          <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">LIVE mode</p>
                <p className="text-xs text-muted-foreground">
                  Push the current score to the public grid as{" "}
                  <span className="text-live">IF IT ENDED NOW</span>.
                </p>
              </div>
              <Switch checked={liveMode} onCheckedChange={setLiveMode} />
            </div>
            {liveMode && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={!valid || pending || game?.status === "final"}
                  onClick={pushLive}
                >
                  Push live score
                </Button>
                <Button
                  variant="ghost"
                  disabled={pending || game?.live_home === null}
                  onClick={clearLive}
                >
                  Clear
                </Button>
              </div>
            )}
            {game?.live_home !== null && game && (
              <p className="text-xs text-live" data-numeric>
                Live now: {game.away_team.split(" ").at(-1)} {game.live_away} at{" "}
                {game.home_team.split(" ").at(-1)} {game.live_home}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          {previewGame && (
            <BlocksGrid
              game={previewGame}
              blocks={blocks}
              config={config}
              mode="fit"
            />
          )}
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm the score</DialogTitle>
            <DialogDescription className="text-base text-foreground" data-numeric>
              {game && away !== null && home !== null
                ? echoConfirm(
                    game.game_no,
                    type,
                    game.away_team,
                    away,
                    game.home_team,
                    home,
                  )
                : ""}
            </DialogDescription>
          </DialogHeader>
          {previewBlock !== null && (
            <p className="text-sm text-muted-foreground" data-numeric>
              Winning block {previewBlock}
              {previewOwner?.display_name
                ? ` — ${previewOwner.display_name}, ${fmtUsd(amount)} ${previewOwner.status === "assigned" ? "payout will be created as owed" : `(${previewOwner.status} — NO payout, review flag)`}`
                : " — unclaimed: no payout, review flag"}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              No, go back
            </Button>
            <Button autoFocus disabled={pending} onClick={submitScore}>
              {pending ? "Scoring…" : "Yes, record it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
