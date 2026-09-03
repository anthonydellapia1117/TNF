"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import {
  BoardToggle,
  boardCounts,
  useBoardShowMode,
  type BoardShowMode,
} from "@/components/board/board-toggle";
import {
  OWNER_GROUPS,
  type OwnerGroup,
  type PoolConfig,
  type PublicBlock,
} from "@/lib/types";

type ColorMode = "status" | "owner";

const MODE_KEY = "tnf-board-color";

/** Owner-group palette (spec 4.3) — inline styles, tuned for the dark surface. */
export const GROUP_COLORS: Record<OwnerGroup, string> = {
  AVD: "#4F7CFF",
  MAP: "#9B7BEA",
  RM: "#1FA36B",
  JPOD: "#FB8C4F",
  EJD: "#E36FA5",
  NL: "#00B8C4",
  GD: "#E05252",
};

export function BoardGrid({
  blocks,
  config,
}: {
  blocks: PublicBlock[];
  config: PoolConfig;
}) {
  const [mode, setMode] = useState<ColorMode>("status");
  const [show, setShow] = useBoardShowMode();

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MODE_KEY);
      if (stored === "status" || stored === "owner") setMode(stored);
    } catch {
      // storage unavailable — keep the default
    }
  }, []);

  const setModePersist = (m: ColorMode) => {
    setMode(m);
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      // best effort
    }
  };

  const byNumber = new Map(blocks.map((b) => [b.block_number, b]));
  const price = fmtUsd(config.price_per_block_cents);

  let open = 0;
  let taken = 0;
  let held = 0;
  const groupCounts = new Map<OwnerGroup, number>();
  for (let n = 1; n <= 100; n++) {
    const b = byNumber.get(n);
    const status = b?.status ?? "available";
    if (status === "available") open++;
    else if (status === "held") held++;
    else taken++;
    if (b?.owner_group && status !== "available") {
      groupCounts.set(b.owner_group, (groupCounts.get(b.owner_group) ?? 0) + 1);
    }
  }

  const counts = boardCounts(
    Array.from({ length: 100 }, (_, i) => byNumber.get(i + 1) ?? { status: "available" as const }),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* OPEN / CLAIMED / ALL — views filter, data persists (spec B1) */}
        <BoardToggle mode={show} counts={counts} onChange={setShow} />

        {/* Color-by toggle (spec B3) */}
        <div className="flex items-center gap-1">
          {(["status", "owner"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModePersist(m)}
              aria-pressed={mode === m}
              className={cn(
                "rounded-md border px-2.5 py-1 text-2xs font-medium transition-colors duration-150",
                mode === m
                  ? "border-pool-accent/60 bg-pool-accent/15 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "status" ? "By status" : "By owner group"}
            </button>
          ))}
        </div>
      </div>

      {/* The board: 10 columns always, block-number order (1 top-left, 100
          bottom-right). Filtering dims rather than removes — the geometry
          is the point, and nothing is ever deleted. */}
      <div className="mx-auto grid w-full max-w-3xl grid-cols-10 gap-1 sm:gap-1.5">
        {Array.from({ length: 100 }, (_, i) => (
          <BoardCell
            key={i + 1}
            n={i + 1}
            block={byNumber.get(i + 1)}
            mode={mode}
            show={show}
            price={price}
          />
        ))}
      </div>

      {/* Legend beneath the board */}
      {mode === "status" ? (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-2xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-[2px] border border-dashed border-pool-accent/60 bg-pool-accent/10"
              aria-hidden
            />
            Open numbers <span data-numeric>{open}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-[2px] border border-border bg-surface-2"
              aria-hidden
            />
            Placed <span data-numeric>{taken}</span>
          </span>
          {held > 0 && (
            <span className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-[2px] border border-border/60 bg-surface-2/40"
                aria-hidden
              />
              Held <span data-numeric>{held}</span>
            </span>
          )}
        </div>
      ) : groupCounts.size > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-2xs text-muted-foreground">
          {OWNER_GROUPS.map((g) => {
            const count = groupCounts.get(g) ?? 0;
            if (count === 0) return null;
            return (
              <span key={g} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-[2px]"
                  style={{ backgroundColor: GROUP_COLORS[g] }}
                  aria-hidden
                />
                {g} <span data-numeric>{count}</span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-center text-2xs text-muted-foreground">
          No owners yet — every block is still open.
        </p>
      )}
    </div>
  );
}

function BoardCell({
  n,
  block,
  mode,
  show,
  price,
}: {
  n: number;
  block: PublicBlock | undefined;
  mode: ColorMode;
  show: BoardShowMode;
  price: string;
}) {
  const status = block?.status ?? "available";
  const name = block?.display_name ?? null;
  const group = block?.owner_group ?? null;
  const isOpen = status === "available";
  const isHeld = status === "held";
  const byOwner = mode === "owner" && !isOpen && group !== null;
  const matchesShow =
    show === "all" ||
    (show === "open" ? isOpen : status === "reserved" || status === "assigned");

  const label = isOpen
    ? `Block ${n} — open, ${price}`
    : `Block ${n} — ${name ?? (isHeld ? "held" : "taken")}${group ? ` (${group})` : ""}`;

  return (
    <Link
      href={`/block/${n}`}
      aria-label={label}
      title={label}
      className={cn(
        "group relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-[4px] border text-center transition-opacity duration-150 sm:aspect-auto sm:h-16",
        !matchesShow && "opacity-20 saturate-50",
        // Available: loud — dashed accent border, open affordance on hover.
        isOpen &&
          "border-dashed border-pool-accent/60 bg-pool-accent/[0.04] hover:border-pool-accent hover:bg-pool-accent/10",
        // Taken: quiet — solid surface, muted alias.
        !isOpen &&
          !isHeld &&
          "border-border bg-surface-2 hover:border-pool-accent/50",
        // Held: dim.
        isHeld && "border-border/60 bg-surface-2/40 hover:border-pool-accent/40",
        byOwner && "border-l-4",
      )}
      style={byOwner && group ? { borderLeftColor: GROUP_COLORS[group] } : undefined}
    >
      {/* Paid glyph: Assigned vs Reserved, never by color alone (spec B2). */}
      {status === "assigned" && (
        <BadgeCheck
          className="absolute top-0.5 right-0.5 size-3 text-emerald-400"
          aria-hidden
        />
      )}
      <span
        className={cn(
          "tabular-nums",
          isOpen && "text-sm font-semibold text-foreground sm:text-base",
          !isOpen && !isHeld && "text-2xs font-medium text-muted-foreground sm:text-xs",
          isHeld && "text-2xs text-muted-foreground/40 sm:text-xs",
        )}
        data-numeric
      >
        {n}
      </span>
      {isOpen ? (
        <span
          className="hidden text-2xs font-medium tracking-wide text-pool-accent opacity-0 transition-opacity duration-150 group-hover:opacity-100 sm:block"
          aria-hidden
        >
          open
        </span>
      ) : (
        name && (
          <span
            className={cn(
              "hidden max-w-full truncate px-1 text-2xs leading-tight sm:block",
              isHeld ? "text-muted-foreground/40" : "text-muted-foreground",
            )}
          >
            {name}
          </span>
        )
      )}
    </Link>
  );
}
