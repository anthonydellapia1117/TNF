"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ImageDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import { payoutCents, winningBlock, isPermutation } from "@/lib/pool";
import type { PoolConfig, PublicBlock, PublicGame } from "@/lib/types";

/** One tap copies the 1200x630 share card for the group chat (spec 4.8). */
function ShareCardButton({ cardUrl }: { cardUrl: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const blob = await fetch(cardUrl).then((r) => r.blob());
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard images aren't supported everywhere - open the card instead.
      window.open(cardUrl, "_blank", "noopener");
    }
  };
  return (
    <button
      onClick={copy}
      aria-label="Copy the share card image"
      title="Copy share card"
      className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-400" />
      ) : (
        <ImageDown className="size-3.5" />
      )}
    </button>
  );
}

function Row({
  icon,
  label,
  labelClass,
  block,
  name,
  amount,
  pulse,
  cardUrl,
  review,
}: {
  icon: string;
  label: string;
  labelClass: string;
  block: number;
  name: string | null;
  amount: string | null;
  pulse?: boolean;
  cardUrl?: string;
  /** Winning block is not Assigned: no payout exists (spec D6/E2). */
  review?: boolean;
}) {
  return (
    <Link
      href={`/block/${block}`}
      className={cn(
        "flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5 transition-colors duration-150 hover:bg-surface-2",
        pulse && "border-live/50",
        review && "border-destructive/60",
      )}
    >
      <span className="text-lg" aria-hidden>
        {review ? "⚠️" : icon}
      </span>
      <span
        className={cn(
          "w-16 shrink-0 text-2xs font-bold tracking-widest",
          review ? "text-destructive" : labelClass,
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
      {review ? (
        <span className="text-2xs font-bold tracking-wide text-destructive">
          NO PAYOUT · REVIEW
        </span>
      ) : (
        amount && (
          <span className="text-sm font-semibold tabular-nums" data-numeric>
            {amount}
          </span>
        )
      )}
      {cardUrl && !review && <ShareCardButton cardUrl={cardUrl} />}
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
          cardUrl={`/api/card/${game.id}/final.png`}
          review={byNumber.get(game.final_block)?.status !== "assigned"}
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
          cardUrl={`/api/card/${game.id}/halftime.png`}
          review={byNumber.get(game.halftime_block)?.status !== "assigned"}
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
