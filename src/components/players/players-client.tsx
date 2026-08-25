"use client";

// The public Players roster: read-only, one row per claimed block. Search,
// sort by any column (state in the URL), group filter for the co-runners.
// FULL mode shows method/status/group; LEAN is #, player, block only.
// Rows link to the block's read-only detail page — no edit controls exist.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublicBlock } from "@/lib/types";
import {
  compareValues,
  useTableSort,
  type TableSort,
} from "@/components/admin/use-table-sort";
import { Input } from "@/components/ui/input";

const FULL_SORT_KEYS = ["player", "group", "block", "method", "status"] as const;
const LEAN_SORT_KEYS = ["player", "block"] as const;
type SortKey = (typeof FULL_SORT_KEYS)[number];

const STATUS_LABEL: Record<string, string> = {
  reserved: "Reserved",
  assigned: "Assigned",
};

export function PlayersClient({
  blocks,
  mode,
}: {
  blocks: PublicBlock[];
  mode: "full" | "lean";
}) {
  const full = mode === "full";
  const keys = full ? FULL_SORT_KEYS : LEAN_SORT_KEYS;
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>("all");
  const [sort, toggleSort] = useTableSort<SortKey>(
    keys as readonly SortKey[],
    { key: "player", dir: "asc" },
  );

  const groups = useMemo(
    () =>
      [...new Set(blocks.map((b) => b.owner_group).filter(Boolean))].sort() as string[],
    [blocks],
  );

  const q = query.trim().toLowerCase();
  const sortValue = (b: PublicBlock): unknown => {
    switch (sort.key) {
      case "player":
        return (b.display_name ?? "").toLowerCase();
      case "group":
        return b.owner_group ?? "";
      case "block":
        return b.block_number;
      case "method":
        return b.assignment_method ?? "";
      case "status":
        return b.status;
    }
  };

  const visible = useMemo(
    () =>
      blocks
        .filter(
          (b) =>
            (group === "all" || b.owner_group === group) &&
            (!q ||
              [
                b.display_name ?? "",
                String(b.block_number),
                full ? (b.owner_group ?? "") : "",
                full ? (b.assignment_method ?? "") : "",
                full ? b.status : "",
              ]
                .join(" ")
                .toLowerCase()
                .includes(q)),
        )
        .sort(
          (a, b) =>
            (sort.dir === "asc" ? 1 : -1) *
              compareValues(sortValue(a), sortValue(b)) ||
            // Stable tie-break: alias, then block number — Jr/Diz's two rows
            // always sit together in block order.
            (a.display_name ?? "").localeCompare(b.display_name ?? "") ||
            a.block_number - b.block_number,
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blocks, q, group, sort, full],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl">Players</h1>
          <p className="mt-0.5 text-sm text-muted-foreground" data-numeric>
            {visible.length === blocks.length
              ? `${blocks.length} claimed blocks`
              : `${visible.length} of ${blocks.length} claimed blocks`}
          </p>
        </div>
        <Link
          href="/list"
          className="shrink-0 pt-1 text-xs text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline"
        >
          Copy list
        </Link>
      </div>

      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={full ? "Search player, block, group…" : "Search player or block…"}
        autoComplete="off"
        aria-label="Search players"
        className="h-12 sm:h-8"
      />

      {full && groups.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Filter by owner group"
          className="flex items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-surface p-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {["all", ...groups].map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={group === g}
              onClick={() => setGroup(g)}
              className={cn(
                "flex h-9 shrink-0 items-center rounded-md px-3 text-xs font-semibold tracking-wide whitespace-nowrap uppercase transition-colors duration-150",
                group === g
                  ? "bg-surface-2 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g === "all" ? "All groups" : g}
            </button>
          ))}
        </div>
      )}

      {/* Sort header. On phones in FULL mode, Method and Status share one
          folded cell — the sort buttons still target each independently. */}
      <div className="flex items-center gap-2 px-3 text-2xs tracking-widest text-muted-foreground uppercase">
        <span className="w-7" data-numeric>
          #
        </span>
        <span className="min-w-0 flex-1">
          <Head label="Player" k="player" sort={sort} onSort={toggleSort} />
        </span>
        {full && (
          <span className="hidden w-14 sm:block">
            <Head label="Group" k="group" sort={sort} onSort={toggleSort} />
          </span>
        )}
        <span className="w-12 text-right">
          <Head label="Block" k="block" sort={sort} onSort={toggleSort} />
        </span>
        {full && (
          <span className="flex w-20 flex-col items-start gap-0.5 sm:w-40 sm:flex-row sm:gap-3">
            <Head label="Method" k="method" sort={sort} onSort={toggleSort} />
            <Head label="Status" k="status" sort={sort} onSort={toggleSort} />
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
          Nobody matches.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          {visible.map((b, i) => (
            <Link
              key={b.block_number}
              href={`/block/${b.block_number}`}
              className="flex min-h-12 items-center gap-2 border-b border-border px-3 py-2 transition-colors duration-150 last:border-b-0 hover:bg-surface-2"
            >
              <span className="w-7 shrink-0 text-xs text-muted-foreground" data-numeric>
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {b.display_name ?? "—"}
              </span>
              {full && (
                <span className="hidden w-14 shrink-0 text-xs text-muted-foreground sm:block">
                  {b.owner_group ?? ""}
                </span>
              )}
              <span
                className="w-12 shrink-0 text-right text-sm font-semibold"
                data-numeric
              >
                #{b.block_number}
              </span>
              {full && (
                <span className="flex w-20 shrink-0 flex-col items-start gap-0.5 sm:w-40 sm:flex-row sm:items-center sm:gap-3">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-2xs font-semibold tracking-wide",
                      b.assignment_method === "requested"
                        ? "text-final"
                        : "text-muted-foreground",
                    )}
                  >
                    {b.assignment_method === "requested" && (
                      <span className="size-1.5 rounded-full bg-final" aria-hidden />
                    )}
                    {(b.assignment_method ?? "").toUpperCase()}
                  </span>
                  <span
                    className={cn(
                      "text-2xs",
                      b.status === "reserved"
                        ? "text-halftime"
                        : "text-foreground",
                    )}
                  >
                    {STATUS_LABEL[b.status] ?? b.status}
                  </span>
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      <p className="text-2xs text-muted-foreground">
        Tap a row for that block&apos;s season detail. Read-only.
      </p>
    </div>
  );
}

function Head({
  label,
  k,
  sort,
  onSort,
}: {
  label: string;
  k: SortKey;
  sort: TableSort<SortKey>;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === k;
  const Chevron = sort.dir === "desc" ? ChevronDown : ChevronUp;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={cn(
        "inline-flex items-center gap-0.5 uppercase transition-colors hover:text-foreground",
        active && "text-foreground",
      )}
    >
      {label}
      {active && <Chevron className="size-3" />}
    </button>
  );
}
