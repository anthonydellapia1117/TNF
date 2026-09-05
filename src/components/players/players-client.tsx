"use client";

// The public Players roster: read-only, one row per claimed block. Search,
// sort by any column (state in the URL).
// FULL mode adds the assignment method; LEAN is #, player, block only.
//
// No owner group here. Owner codes are collection responsibility and are
// admin-only since migration 18 - v_public_blocks serves NULL for them to a
// non-admin caller, so a group column, filter or sort would render blank.
// Method speaks a two-word vocabulary - REQUESTED (green) or RANDOMIZED
// (orange) - and status never appears here: reserved-vs-assigned is a
// payment distinction that lives on /admin. Rows link to the block's
// read-only detail page - no edit controls exist.

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
import { MethodChip, methodLabel } from "@/components/players/method-chip";

const FULL_SORT_KEYS = ["player", "block", "method"] as const;
const LEAN_SORT_KEYS = ["player", "block"] as const;
type SortKey = (typeof FULL_SORT_KEYS)[number];

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
  const [sort, toggleSort] = useTableSort<SortKey>(
    keys as readonly SortKey[],
    { key: "player", dir: "asc" },
  );

  const q = query.trim().toLowerCase();
  const sortValue = (b: PublicBlock): unknown => {
    switch (sort.key) {
      case "player":
        return (b.display_name ?? "").toLowerCase();
      case "block":
        return b.block_number;
      case "method":
        return methodLabel(b.assignment_method);
    }
  };

  const visible = useMemo(
    () =>
      blocks
        .filter(
          (b) =>
            (!q ||
              [
                b.display_name ?? "",
                String(b.block_number),
                full ? methodLabel(b.assignment_method) : "",
              ]
                .join(" ")
                .toLowerCase()
                .includes(q)),
        )
        .sort(
          (a, b) =>
            (sort.dir === "asc" ? 1 : -1) *
              compareValues(sortValue(a), sortValue(b)) ||
            // Stable tie-break: alias, then block number - Jr/Diz's two rows
            // always sit together in block order.
            (a.display_name ?? "").localeCompare(b.display_name ?? "") ||
            a.block_number - b.block_number,
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blocks, q, sort, full],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl">Players</h1>
          {/* No roster size. How many people are in is administrative - the
              board at /blocks is where availability belongs. A search shows
              how many rows matched, which says nothing about the total. */}
          <p className="mt-0.5 text-sm text-muted-foreground" data-numeric>
            {visible.length === blocks.length
              ? "Every claimed block and the name on it."
              : `${visible.length} matching`}
          </p>
        </div>
      </div>

      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={full ? "Search player, block or method…" : "Search player or block…"}
        autoComplete="off"
        aria-label="Search players"
        className="h-12 sm:h-8"
      />

      {/* Column header - four columns fit a 390px phone with no folding. */}
      <div className="flex items-center gap-2 px-3 text-2xs tracking-widest text-muted-foreground uppercase">
        <span className="w-6" data-numeric>
          #
        </span>
        <span className="min-w-0 flex-1">
          <Head label="Player" k="player" sort={sort} onSort={toggleSort} />
        </span>
        {full && (
          <span className="w-12">
          </span>
        )}
        <span className="w-10 text-right">
          <Head label="Block" k="block" sort={sort} onSort={toggleSort} />
        </span>
        {full && (
          <span className="w-24 text-right">
            <Head label="Method" k="method" sort={sort} onSort={toggleSort} />
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
              <span className="w-6 shrink-0 text-xs text-muted-foreground" data-numeric>
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {b.display_name ?? "-"}
              </span>
              <span
                className="w-10 shrink-0 text-right text-sm font-semibold"
                data-numeric
              >
                #{b.block_number}
              </span>
              {full && (
                <span className="flex w-24 shrink-0 justify-end">
                  <MethodChip method={b.assignment_method} />
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
