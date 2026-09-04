"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import { teamPalette } from "@/lib/nfl";
import {
  adjacentBlocks,
  amountBadge,
  blockPosition,
  isPermutation,
  payoutCents,
  winningBlock,
  gridAxes,
} from "@/lib/pool";
import type { PoolConfig, PublicBlock, PublicGame } from "@/lib/types";
import {
  BADGE_BG,
  BADGE_TEXT,
  WIN_FILL,
  WIN_FILL_TEXT,
  WIN_OUTLINE,
  WIN_OUTLINE_ON_FILL,
} from "@/lib/winner-colors";

export type GridMode = "fit" | "comfortable";

interface CellState {
  n: number;
  block: PublicBlock | undefined;
  isHalf: boolean;
  isFinal: boolean;
  isLive: boolean;
  isNearMiss: boolean;
  inRevealRow: boolean;
  inRevealCol: boolean;
}

export function BlocksGrid({
  game,
  blocks,
  config,
  mode,
}: {
  game: PublicGame;
  blocks: PublicBlock[];
  config: PoolConfig;
  mode: GridMode;
}) {
  const published =
    isPermutation(game.row_digits) && isPermutation(game.col_digits);
  const rows = published ? (game.row_digits as number[]) : null;
  const cols = published ? (game.col_digits as number[]) : null;

  const halfBlock = game.halftime_block;
  const finalBlock = game.final_block;
  const liveBlock =
    rows && cols && game.final_home === null && game.live_home !== null
      ? winningBlock(rows, cols, game.live_home, game.live_away as number)
      : null;

  // The reveal: the most decisive scored event lights its row and column.
  const revealBlock = finalBlock ?? halfBlock;
  const revealPos = revealBlock ? blockPosition(revealBlock) : null;
  const nearMiss = new Set(finalBlock ? adjacentBlocks(finalBlock) : []);

  const blockMap = new Map(blocks.map((b) => [b.block_number, b]));
  // Which team is on which axis comes from gridAxes, which is unit-tested
  // against winningBlock. Do not hardcode home/away here — labels drifting
  // from the payout math is the failure this indirection exists to stop.
  const axes = gridAxes(game);
  const rowAxis = { team: axes.rowTeam, label: axes.rowLabel, ...teamPalette(axes.rowTeam) };
  const colAxis = { team: axes.colTeam, label: axes.colLabel, ...teamPalette(axes.colTeam) };
  const halfAmount = payoutCents(game.game_type, "halftime", config);
  const finalAmount = payoutCents(game.game_type, "final", config);

  const comfortable = mode === "comfortable";

  const cellFor = (r: number, c: number): CellState => {
    const n = r * 10 + c + 1;
    return {
      n,
      block: blockMap.get(n),
      isHalf: halfBlock === n,
      isFinal: finalBlock === n,
      isLive: liveBlock === n && finalBlock !== n,
      isNearMiss: nearMiss.has(n) && finalBlock !== n && halfBlock !== n,
      inRevealRow: revealPos !== null && revealPos.row === r,
      inRevealCol: revealPos !== null && revealPos.col === c,
    };
  };

  return (
    <div
      className={cn(
        "flex items-stretch gap-1",
        comfortable ? "mx-auto w-fit max-w-full" : "mx-auto w-full max-w-2xl",
      )}
    >
      {/* Away axis: a solid vertical rail in the team's color, name rotated,
          pinned outside the scroll area (spec A3). AWAY is the vertical axis
          — see winningBlock in src/lib/pool.ts. */}
      <div className="flex shrink-0 items-stretch">
        <div
          className="flex w-5 items-center justify-center overflow-hidden rounded-md sm:w-6"
          style={{ backgroundColor: rowAxis.bar.bg }}
        >
          <p
            className="rotate-180 text-2xs font-bold tracking-widest whitespace-nowrap uppercase [writing-mode:vertical-rl]"
            style={{ color: rowAxis.bar.fg }}
          >
            {rowAxis.label} · {rowAxis.team}
          </p>
        </div>
      </div>

      <div
        className={cn(
          "min-w-0 flex-1",
          comfortable && "overflow-x-auto pt-2.5 pb-2",
        )}
      >
        <div className={comfortable ? "w-max min-w-full" : undefined}>
          <div
            className="grid gap-[3px]"
            style={{
              gridTemplateColumns: comfortable
                ? "1.75rem repeat(10, 3.5rem)"
                : "1.125rem repeat(10, minmax(0, 1fr))",
            }}
          >
            {/* Home axis: a full-width solid bar in the team's color with the
                digit cells sitting inside it (spec A3). HOME is the
                horizontal axis — see winningBlock in src/lib/pool.ts.
                The corner above the away rail carries the week number, where
                the hand-built grid has always put it. */}
            <div
              className={cn(
                "sticky left-0 z-10 flex items-center justify-center bg-background",
                !comfortable && "static",
              )}
            >
              <span className="text-2xs font-bold tracking-widest text-muted-foreground uppercase">
                W{game.week}
              </span>
            </div>
            <div
              className="flex h-6 items-center justify-center rounded-t-md text-2xs font-bold tracking-widest uppercase"
              style={{
                gridColumn: "2 / -1",
                backgroundColor: colAxis.bar.bg,
                color: colAxis.bar.fg,
              }}
            >
              {colAxis.label} · {colAxis.team}
            </div>

            <div
              className={cn(
                "sticky left-0 z-10 bg-background",
                !comfortable && "static",
              )}
            />
            {Array.from({ length: 10 }, (_, c) => (
              <div
                key={`ch-${c}`}
                className={cn(
                  "digit-in rounded-b-[4px] py-0.5 text-center text-sm font-semibold tabular-nums",
                  !published && "opacity-70",
                )}
                style={{
                  backgroundColor: colAxis.bar.bg,
                  color: colAxis.bar.fg,
                  ["--digit-i" as string]: c,
                }}
                data-numeric
              >
                {cols ? cols[c] : "?"}
              </div>
            ))}

            {Array.from({ length: 10 }, (_, r) => (
              <RowCells
                key={`r-${r}`}
                r={r}
                rows={rows}
                rowBar={rowAxis.bar}
                published={published}
                comfortable={comfortable}
                cellFor={cellFor}
                revealFinal={finalBlock !== null}
                halfAmount={halfAmount}
                finalAmount={finalAmount}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RowCells({
  r,
  rows,
  rowBar,
  published,
  comfortable,
  cellFor,
  revealFinal,
  halfAmount,
  finalAmount,
}: {
  r: number;
  rows: number[] | null;
  rowBar: { bg: string; fg: string };
  published: boolean;
  comfortable: boolean;
  cellFor: (r: number, c: number) => CellState;
  revealFinal: boolean;
  halfAmount: number;
  finalAmount: number;
}) {
  return (
    <>
      {/* Away digit cell: sits inside the away team's colored rail. */}
      <div
        className={cn(
          "digit-in flex items-center justify-center rounded-[4px] text-sm font-semibold tabular-nums",
          !published && "opacity-70",
          comfortable && "sticky left-0 z-10",
        )}
        style={{
          backgroundColor: rowBar.bg,
          color: rowBar.fg,
          ["--digit-i" as string]: 10 + r,
        }}
        data-numeric
      >
        {rows ? rows[r] : "?"}
      </div>
      {Array.from({ length: 10 }, (_, c) => (
        <GridCell
          key={`c-${r}-${c}`}
          cell={cellFor(r, c)}
          comfortable={comfortable}
          revealFinal={revealFinal}
          halfAmount={halfAmount}
          finalAmount={finalAmount}
        />
      ))}
    </>
  );
}

/** Floating prize pill — a stat callout, not a casino graphic. */
function PrizeBadge({
  amount,
  filled,
  offset,
}: {
  amount: number;
  filled: boolean;
  offset: number;
}) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-full border px-1.5 py-px text-[9px] leading-tight font-bold tracking-wide tabular-nums whitespace-nowrap"
      style={{
        top: `${-9 - offset * 14}px`,
        backgroundColor: filled ? WIN_FILL : BADGE_BG,
        borderColor: filled ? WIN_FILL : WIN_OUTLINE,
        color: filled ? WIN_FILL_TEXT : BADGE_TEXT,
      }}
      data-numeric
    >
      {amountBadge(amount)}
    </span>
  );
}

function GridCell({
  cell,
  comfortable,
  revealFinal,
  halfAmount,
  finalAmount,
}: {
  cell: CellState;
  comfortable: boolean;
  revealFinal: boolean;
  halfAmount: number;
  finalAmount: number;
}) {
  const b = cell.block;
  const status = b?.status ?? "available";
  const name = b?.display_name ?? null;
  const taken = status === "reserved" || status === "assigned";
  const open = status === "available";
  const both = cell.isHalf && cell.isFinal;
  // E2: a winning block that is not Assigned is a review flag — red
  // overrides every other state, and no amount is shown because no payout
  // exists.
  const review = (cell.isHalf || cell.isFinal) && status !== "assigned";
  const winFill = cell.isFinal && !review;
  const winOutline = cell.isHalf && !review;

  const label = [
    `Block ${cell.n}`,
    name ? `— ${name}` : "— open",
    review
      ? `· winning block is ${status} — under review, no payout`
      : [
          cell.isFinal ? `· final winner ${fmtUsd(finalAmount)}` : "",
          cell.isHalf ? `· halftime winner ${fmtUsd(halfAmount)}` : "",
        ]
          .filter(Boolean)
          .join(" "),
    cell.isLive ? "· leading if it ended now" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link
      href={`/block/${cell.n}`}
      aria-label={label}
      title={label}
      className={cn(
        "relative flex flex-col items-center justify-center rounded-[4px] border text-center transition-colors duration-150",
        comfortable ? "h-14" : "aspect-square",
        // Taken vs open is THE distinction on the grid (requested-vs-random
        // lives on /players; paid-vs-reserved lives on /admin).
        open &&
          "border-dashed border-pool-accent/60 bg-pool-accent/[0.08] text-foreground hover:border-pool-accent hover:bg-pool-accent/[0.14]",
        taken &&
          "border-border bg-surface-2 text-foreground hover:border-pool-accent/50",
        status === "held" &&
          "border-border/60 bg-transparent text-muted-foreground",
        // Winner treatments override the base; green means winner, only ever.
        winFill && "reveal-cell z-10",
        winOutline && !winFill && "z-10 ring-2 ring-inset",
        // The review flag overrides everything (spec E2).
        review &&
          "reveal-cell z-10 border-destructive bg-destructive/15 ring-2 ring-destructive/70 ring-inset text-foreground",
        cell.isLive && "live-pulse z-10 border-live",
      )}
      style={{
        ...(winFill
          ? {
              backgroundColor: WIN_FILL,
              borderColor: both ? WIN_OUTLINE_ON_FILL : WIN_FILL,
              color: WIN_FILL_TEXT,
            }
          : {}),
        ...(winOutline && !winFill
          ? ({
              borderColor: WIN_OUTLINE,
              "--tw-ring-color": WIN_OUTLINE,
            } as React.CSSProperties)
          : {}),
        ...(both && !review
          ? ({ boxShadow: `inset 0 0 0 2px ${WIN_OUTLINE_ON_FILL}` } as React.CSSProperties)
          : {}),
      }}
    >
      {/* Winner reveal: the row and column converge on the cell. */}
      {(cell.inRevealRow || cell.inRevealCol) &&
        !cell.isFinal &&
        !cell.isHalf && (
          <span
            aria-hidden
            className="reveal-wash pointer-events-none absolute inset-0 rounded-[4px]"
            style={{
              background: `color-mix(in srgb, ${
                revealFinal ? WIN_FILL : WIN_OUTLINE
              } 12%, transparent)`,
            }}
          />
        )}
      {cell.isNearMiss && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[4px]"
          style={{
            background: `color-mix(in srgb, ${WIN_FILL} 8%, transparent)`,
          }}
        />
      )}

      {/* Floating prize badges — stacked when one box takes both. */}
      {!review && cell.isFinal && (
        <PrizeBadge amount={finalAmount} filled offset={0} />
      )}
      {!review && cell.isHalf && (
        <PrizeBadge amount={halfAmount} filled={false} offset={both ? 1 : 0} />
      )}

      {comfortable ? (
        <>
          <span
            className={cn(
              "absolute top-0.5 left-1 text-2xs tabular-nums",
              !winFill && !open && "text-muted-foreground",
              !winFill && open && "text-foreground/80",
            )}
            style={winFill ? { color: WIN_FILL_TEXT, opacity: 0.75 } : undefined}
            data-numeric
          >
            {cell.n}
          </span>
          {review && (
            <TriangleAlert className="size-3.5 text-destructive" aria-hidden />
          )}
          {name && (
            <span className="max-w-full truncate px-1 text-2xs leading-tight font-medium">
              {name}
            </span>
          )}
          {open && !cell.isHalf && !cell.isFinal && (
            <span className="text-[9px] font-semibold tracking-[0.2em] text-pool-accent uppercase">
              open
            </span>
          )}
          {review && (
            <span className="text-[9px] font-bold tracking-wide text-destructive">
              ⚠ REVIEW · NO PAYOUT
            </span>
          )}
          {cell.isLive && (
            <span className="text-[8px] font-bold tracking-wide text-live">
              IF IT ENDED NOW
            </span>
          )}
        </>
      ) : (
        <span
          className={cn(
            "inline-flex items-center gap-px text-2xs tabular-nums",
            winFill || open ? "font-semibold" : "font-medium",
          )}
          data-numeric
        >
          {review && (
            <TriangleAlert className="size-2.5 text-destructive" aria-hidden />
          )}
          {cell.n}
        </span>
      )}
    </Link>
  );
}
