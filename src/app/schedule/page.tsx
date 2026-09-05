import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StatusChip } from "@/components/grid/status-chip";
import { SeasonStrip } from "@/components/schedule/season-strip";
import {
  currentGame,
  getConfig,
  getPublicBlocks,
  getPublicGames,
} from "@/lib/data/public";
import { fmtKickoffET, fmtUsd } from "@/lib/format";
import { teamPalette } from "@/lib/nfl";
import { gameCode, payoutCents } from "@/lib/pool";
import { cn } from "@/lib/utils";
import type { PoolConfig, PublicBlock, PublicGame } from "@/lib/types";

export const metadata: Metadata = {
  title: "Schedule",
  description:
    "The 2026 season - all 23 games, states, digits, and payouts, week by week.",
};

export const revalidate = 30;

function TeamRow({ name, score }: { name: string; score: number | null }) {
  const p = teamPalette(name);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className="size-2.5 shrink-0 rounded-[3px]"
        style={{ backgroundColor: p.bar.bg }}
        aria-hidden
      />
      <span
        className="min-w-0 truncate text-sm font-semibold tracking-wide uppercase"
        style={{ color: p.display }}
      >
        {name}
      </span>
      {score !== null && (
        <span className="ml-auto text-sm font-semibold tabular-nums" data-numeric>
          {score}
        </span>
      )}
    </div>
  );
}

function WinnerLine({
  kind,
  block,
  owner,
  amount,
}: {
  kind: "halftime" | "final";
  block: number;
  owner: PublicBlock | undefined;
  amount: number;
}) {
  const review = owner?.status !== "assigned";
  return (
    <div className="flex items-center gap-2 text-xs" data-numeric>
      <span
        className={cn(
          "w-14 font-bold tracking-wide",
          review
            ? "text-destructive"
            : kind === "final"
              ? "text-final"
              : "text-halftime",
        )}
      >
        {review ? "⚠" : kind === "final" ? "🏆" : "🥈"}{" "}
        {kind === "final" ? "FINAL" : "HALF"}
      </span>
      <Link href={`/block/${block}`} className="font-semibold hover:underline">
        Block {block}
      </Link>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {owner?.display_name ?? "Unclaimed"}
      </span>
      {review ? (
        <span className="text-2xs font-bold text-destructive">NO PAYOUT · REVIEW</span>
      ) : (
        <span className="font-semibold">{fmtUsd(amount)}</span>
      )}
    </div>
  );
}

function GameCard({
  game,
  config,
  blocks,
  current,
}: {
  game: PublicGame;
  config: PoolConfig;
  blocks: Map<number, PublicBlock>;
  current: boolean;
}) {
  const half = payoutCents(game.game_type, "halftime", config);
  const fin = payoutCents(game.game_type, "final", config);
  const holiday = game.game_type === "holiday";
  const scores = {
    away: game.final_away ?? game.live_away ?? game.halftime_away,
    home: game.final_home ?? game.live_home ?? game.halftime_home,
  };

  return (
    <div
      id={`g${game.game_no}`}
      className={cn(
        "scroll-mt-20 rounded-lg border border-border bg-surface p-4 transition-colors duration-150",
        holiday && "border-l-4 border-l-holiday",
        current && "border-pool-accent/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
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
        <span className={cn(!game.date_confirmed && "text-halftime")} data-numeric>
          {fmtKickoffET(game.kickoff_at)}
        </span>
        {game.network && (
          <>
            <span aria-hidden>·</span>
            <span>{game.network}</span>
          </>
        )}
        <span className="ml-auto">
          <StatusChip game={game} />
        </span>
      </div>

      <div className="mt-3 space-y-1.5">
        <TeamRow name={game.away_team} score={scores.away} />
        <div className="flex items-center gap-2">
          <span className="w-2.5" aria-hidden />
          <span className="text-2xs text-muted-foreground">at</span>
        </div>
        <TeamRow name={game.home_team} score={scores.home} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-numeric>
        <span>
          Halftime <span className="font-medium text-halftime">{fmtUsd(half)}</span>
        </span>
        <span>
          Final <span className="font-medium text-final">{fmtUsd(fin)}</span>
        </span>
        <Link
          href={`/grid?g=${game.game_no}`}
          className="ml-auto inline-flex items-center gap-1 font-medium text-pool-accent hover:underline"
        >
          Grid <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>

      {(game.halftime_block !== null || game.final_block !== null) && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-3">
          {game.final_block !== null && (
            <WinnerLine
              kind="final"
              block={game.final_block}
              owner={blocks.get(game.final_block)}
              amount={fin}
            />
          )}
          {game.halftime_block !== null && (
            <WinnerLine
              kind="halftime"
              block={game.halftime_block}
              owner={blocks.get(game.halftime_block)}
              amount={half}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default async function SchedulePage() {
  const [games, config, blockList] = await Promise.all([
    getPublicGames(),
    getConfig(),
    getPublicBlocks(),
  ]);
  const blocks = new Map(blockList.map((b) => [b.block_number, b]));
  const current = currentGame(games);
  const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl">Schedule</h1>
        <p className="mt-0.5 text-sm text-muted-foreground" data-numeric>
          {games.length} games · all times ET
        </p>
      </div>

      <SeasonStrip games={games} currentGameNo={current?.game_no ?? null} />

      <div className="space-y-6">
        {weeks.map((w) => (
          <section key={w}>
            <h2 className="mb-2 text-2xs font-semibold tracking-widest text-muted-foreground uppercase" data-numeric>
              Week {w}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {games
                .filter((g) => g.week === w)
                .map((g) => (
                  <GameCard
                    key={g.id}
                    game={g}
                    config={config}
                    blocks={blocks}
                    current={g.game_no === current?.game_no}
                  />
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
