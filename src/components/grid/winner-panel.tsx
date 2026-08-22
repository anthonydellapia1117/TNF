"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import { payoutCents, winningBlock, isPermutation } from "@/lib/pool";
import type { PoolConfig, PublicBlock, PublicGame } from "@/lib/types";

function Row({
  icon,
  label,
  labelClass,
  block,
  name,
  amount,
  pulse,
}: {
  icon: string;
  label: string;
  labelClass: string;
  block: number;
  name: string | null;
  amount: string | null;
  pulse?: boolean;
}) {
  return (
    <Link
      href={`/block/${block}`}
      className={cn(
        "flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5 transition-colors duration-150 hover:bg-surface-2",
        pulse && "border-live/50",
      )}
    >
      <span className="text-lg" aria-hidden>
        {icon}
      </span>
      <span
        className={cn(
          "w-16 shrink-0 text-2xs font-bold tracking-widest",
          labelClass,
        )}
      >
        {label}
      </span>
      <span className="text-sm font-semibold whitespace-nowrap" data-numeric>
        Block {block}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {name ?? "Unclaimed"}
      </span>
      {amount && (
        <span className="text-sm font-semibold tabular-nums" data-numeric>
          {amount}
        </span>
      )}
    </Link>
  );
}

export function WinnerPanel({
  game,
  blocks,
  config,
}: {
  game: PublicGame;
  blocks: PublicBlock[];
  config: PoolConfig;
}) {
  const byNumber = new Map(blocks.map((b) => [b.block_number, b]));
  const liveBlock =
    isPermutation(game.row_digits) &&
    isPermutation(game.col_digits) &&
    game.final_home === null &&
    game.live_home !== null
      ? winningBlock(
          game.row_digits as number[],
          game.col_digits as number[],
          game.live_home,
          game.live_away as number,
        )
      : null;

  if (game.final_block === null && game.halftime_block === null && liveBlock === null) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-2">
      {game.final_block !== null && (
        <Row
          icon="🏆"
          label="FINAL"
          labelClass="text-final"
          block={game.final_block}
          name={byNumber.get(game.final_block)?.display_name ?? null}
          amount={fmtUsd(payoutCents(game.game_type, "final", config))}
        />
      )}
      {game.halftime_block !== null && (
        <Row
          icon="🥈"
          label="HALFTIME"
          labelClass="text-halftime"
          block={game.halftime_block}
          name={byNumber.get(game.halftime_block)?.display_name ?? null}
          amount={fmtUsd(payoutCents(game.game_type, "halftime", config))}
        />
      )}
      {liveBlock !== null && (
        <Row
          icon="🔵"
          label="IF NOW"
          labelClass="text-live"
          block={liveBlock}
          name={byNumber.get(liveBlock)?.display_name ?? null}
          amount={null}
          pulse
        />
      )}
    </div>
  );
}
