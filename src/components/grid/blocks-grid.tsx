"use client";

import Link from "next/link";
import { BadgeCheck, TriangleAlert, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import { teamPalette } from "@/lib/nfl";
import {
  adjacentBlocks,
  blockPosition,
  isPermutation,
  payoutCents,
  winningBlock,
} from "@/lib/pool";
import type { PoolConfig, PublicBlock, PublicGame } from "@/lib/types";

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
  const revealGold = finalBlock !== null;
  const nearMiss = new Set(finalBlock ? adjacentBlocks(finalBlock) : []);

  const blockMap = new Map(blocks.map((b) => [b.block_number, b]));
  const away = teamPalette(game.away_team);
  const home = teamPalette(game.home_team);
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
      {/* Home axis: a solid vertical rail in the team's color, name rotated,
          pinned outside the scroll area (spec A3). */}
      <div className="flex shrink-0 items-stretch">
        <div
          className="flex w-5 items-center justify-center overflow-hidden rounded-md sm:w-6"
          style={{ backgroundColor: home.bar.bg }}
        >
          <p
            className="rotate-180 text-2xs font-bold tracking-widest whitespace-nowrap uppercase [writing-mode:vertical-rl]"
            style={{ color: home.bar.fg }}
          >
            home · {game.home_team}
          </p>
        </div>
      </div>

      <div className={cn("min-w-0 flex-1", comfortable && "overflow-x-auto pb-2")}>
        <div className={comfortable ? "w-max min-w-full" : undefined}>
          <div
            className="grid gap-[3px]"
            style={{
              gridTemplateColumns: comfortable
                ? "1.75rem repeat(10, 3.5rem)"
                : "1.125rem repeat(10, minmax(0, 1fr))",
            }}
          >
            {/* Away axis: a full-width solid bar in the team's color with the
                digit cells sitting inside it (spec A3). */}
            <div
              className={cn(
                "sticky left-0 z-10 bg-background",
                !comfortable && "static",
              )}
            />
            <div
              className="flex h-6 items-center justify-center rounded-t-md text-2xs font-bold tracking-widest uppercase"
              style={{
                gridColumn: "2 / -1",
                backgroundColor: away.bar.bg,
                color: away.bar.fg,
              }}
            >
              away · {game.away_team}
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
                  backgroundColor: away.bar.bg,
                  color: away.bar.fg,
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
                homeBar={home.bar}
                published={published}
                comfortable={comfortable}
                cellFor={cellFor}
                revealGold={revealGold}
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
  homeBar,
  published,
  comfortable,
  cellFor,
  revealGold,
  halfAmount,
  finalAmount,
}: {
  r: number;
  rows: number[] | null;
  homeBar: { bg: string; fg: string };
  published: boolean;
  comfortable: boolean;
  cellFor: (r: number, c: number) => CellState;
  revealGold: boolean;
  halfAmount: number;
  finalAmount: number;
}) {
  return (
    <>
      {/* Home digit cell: sits inside the home team's colored rail. */}
      <div
        className={cn(
          "digit-in flex items-center justify-center rounded-[4px] text-sm font-semibold tabular-nums",
          !published && "opacity-70",
          comfortable && "sticky left-0 z-10",
        )}
        style={{
          backgroundColor: homeBar.bg,
          color: homeBar.fg,
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
          revealGold={revealGold}
          halfAmount={halfAmount}
          finalAmount={finalAmount}
        />
      ))}
    </>
  );
}

function GridCell({
  cell,
  comfortable,
  revealGold,
  halfAmount,
  finalAmount,
}: {
  cell: CellState;
  comfortable: boolean;
  revealGold: boolean;
  halfAmount: number;
  finalAmount: number;
}) {
  const b = cell.block;
  const status = b?.status ?? "available";
  const name = b?.display_name ?? null;
  const both = cell.isHalf && cell.isFinal;
  // E2: a winning block that is not Assigned is a review flag — red
  // overrides every other state, and no amount is shown because no payout
  // exists.
  const review = (cell.isHalf || cell.isFinal) && status !== "assigned";

  const label = [
    `Block ${cell.n}`,
    name ? `— ${name}` : "— available",
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
        "relative flex flex-col items-center justify-center overflow-hidden rounded-[4px] border text-center transition-colors duration-150",
        comfortable ? "h-14" : "aspect-square",
        // Base state treatments (spec 4.1 table).
        status === "available" &&
          "border-dashed border-[color:var(--available)] bg-transparent text-muted-foreground hover:border-pool-accent/70",
        status === "reserved" &&
          "border-border bg-[color-mix(in_srgb,var(--reserved)_22%,transparent)] text-muted-foreground hover:border-pool-accent/50",
        status === "assigned" &&
          "border-border bg-surface-2 text-foreground hover:border-pool-accent/50",
        status === "held" &&
          "border-border bg-transparent text-muted-foreground",
        // Winner treatments override the base.
        !review &&
          cell.isFinal &&
          !both &&
          "reveal-cell z-10 border-final bg-final text-black",
        !review &&
          cell.isHalf &&
          !both &&
          "z-10 border-halftime ring-2 ring-halftime ring-inset",
        !review && both && "reveal-cell z-10 border-final text-black",
        // The review flag overrides everything (spec E2).
        review &&
          "reveal-cell z-10 border-destructive bg-destructive/15 ring-2 ring-destructive/70 ring-inset text-foreground",
        cell.isLive && "live-pulse z-10 border-live",
      )}
      style={
        both && !review
          ? {
              background:
                "linear-gradient(135deg, var(--halftime) 0%, var(--halftime) 50%, var(--final) 50%, var(--final) 100%)",
            }
          : undefined
      }
    >
      {/* Winner reveal: the row and column converge on the cell. */}
      {(cell.inRevealRow || cell.inRevealCol) &&
        !cell.isFinal &&
        !cell.isHalf && (
          <span
            aria-hidden
            className="reveal-wash pointer-events-none absolute inset-0"
            style={{
              background: `color-mix(in srgb, ${
                revealGold ? "var(--final)" : "var(--halftime)"
              } 12%, transparent)`,
            }}
          />
        )}
      {cell.isNearMiss && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: "color-mix(in srgb, var(--final) 8%, transparent)",
          }}
        />
      )}

      {comfortable ? (
        <>
          <span
            className={cn(
              "absolute top-0.5 left-1 text-2xs tabular-nums",
              (cell.isFinal || both) && !review
                ? "text-black/70"
                : "text-muted-foreground",
            )}
            data-numeric
          >
            {cell.n}
          </span>
          {/* Paid glyph: Assigned vs Reserved never by color alone (E2). */}
          {status === "assigned" && !cell.isFinal && !both && (
            <BadgeCheck
              className="absolute top-0.5 right-1 size-3 text-emerald-400"
              aria-hidden
            />
          )}
          {review ? (
            <TriangleAlert className="size-3.5 text-destructive" aria-hidden />
          ) : (
            (cell.isFinal || both) && <Trophy className="size-3.5" aria-hidden />
          )}
          {name && (
            <span className="max-w-full truncate px-1 text-2xs leading-tight font-medium">
              {name}
            </span>
          )}
          <span className="flex flex-col items-center leading-none">
            {review ? (
              <span className="text-[9px] font-bold tracking-wide text-destructive">
                ⚠ REVIEW · NO PAYOUT
              </span>
            ) : (
              <>
                {cell.isHalf && (
                  <span
                    className={cn(
                      "text-[9px] font-bold tracking-wide",
                      both ? "text-black/80" : "text-halftime",
                    )}
                    data-numeric
                  >
                    HALF {fmtUsd(halfAmount)}
                  </span>
                )}
                {cell.isFinal && (
                  <span className="text-[9px] font-bold tracking-wide text-black/80" data-numeric>
                    FINAL {fmtUsd(finalAmount)}
                  </span>
                )}
              </>
            )}
            {cell.isLive && (
              <span className="text-[8px] font-bold tracking-wide text-live">
                IF IT ENDED NOW
              </span>
            )}
          </span>
        </>
      ) : (
        <span
          className={cn(
            "inline-flex items-center gap-px text-2xs font-medium tabular-nums",
            (cell.isFinal || both) && !review && "font-bold",
          )}
          data-numeric
        >
          {review && (
            <TriangleAlert className="size-2.5 text-destructive" aria-hidden />
          )}
          {cell.n}
          {status === "assigned" && !cell.isFinal && !both && (
            <BadgeCheck className="size-2.5 text-emerald-400" aria-hidden />
          )}
        </span>
      )}
    </Link>
  );
}
