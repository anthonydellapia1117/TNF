"use client";

// The persistent Open / Taken / All segmented toggle (spec B1). Selection
// lives in the URL (?show=) so views are shareable, and in localStorage so
// the choice survives navigation and reload. ALL is the first-visit
// default — the board is the sales tool, and the whole point is seeing
// what is available against what is gone. Same pattern as the sibling
// pool app's segmented toggle: two apps, one visual language.

import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  BOARD_SHOW_KEY,
  isBoardShowMode,
  type BoardCounts,
  type BoardShowMode,
} from "@/lib/board-filter";

export { boardCounts, isBoardShowMode } from "@/lib/board-filter";
export type { BoardCounts, BoardShowMode } from "@/lib/board-filter";

export function useBoardShowMode(): [BoardShowMode, (m: BoardShowMode) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlMode = params.get("show");
  const mode: BoardShowMode = isBoardShowMode(urlMode) ? urlMode : "all";

  const setMode = useCallback(
    (m: BoardShowMode) => {
      try {
        localStorage.setItem(BOARD_SHOW_KEY, m);
      } catch {
        /* storage unavailable — URL still carries the choice */
      }
      const next = new URLSearchParams(params.toString());
      if (m === "all") next.delete("show");
      else next.set("show", m);
      router.replace(next.size ? `${pathname}?${next}` : pathname, {
        scroll: false,
      });
    },
    [params, pathname, router],
  );

  // First visit without a ?show= param: restore the remembered choice.
  useEffect(() => {
    if (urlMode !== null) return;
    try {
      const saved = localStorage.getItem(BOARD_SHOW_KEY);
      if (isBoardShowMode(saved) && saved !== "all") setMode(saved);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [mode, setMode];
}

// Neutral placement labels, no call to action. Claimed versus unclaimed is
// the admin's paid-versus-unpaid tracker and lives on /admin only.
const LABEL: Record<BoardShowMode, string> = {
  open: "Open",
  taken: "Taken",
  all: "All",
};

export function BoardToggle({
  mode,
  counts,
  onChange,
}: {
  mode: BoardShowMode;
  counts: BoardCounts;
  onChange: (m: BoardShowMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Show open, taken, or all blocks"
      className="inline-flex rounded-lg border border-border bg-surface p-0.5"
    >
      {(["open", "taken", "all"] as BoardShowMode[]).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => onChange(m)}
          className={cn(
            "flex h-9 min-w-16 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold tracking-wide transition-colors duration-150",
            mode === m
              ? m === "open"
                ? "bg-pool-accent/20 text-pool-accent"
                : "bg-surface-2 text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LABEL[m]}
          <span className="tabular-nums opacity-70" data-numeric>
            {counts[m]}
          </span>
        </button>
      ))}
    </div>
  );
}
