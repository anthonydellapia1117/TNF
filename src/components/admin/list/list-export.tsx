"use client";

import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buildListExport } from "@/lib/pool";
import { buildGroupedList, groupedRoster } from "@/lib/grouped-list";
import { Button } from "@/components/ui/button";
import type { AdminBlock, PoolConfig } from "@/lib/types";
import type { ParticipantWithFinance } from "@/lib/data/admin";

type View = "name" | "owner";

const VIEWS = [
  { value: "name", label: "By name", hint: "Alphabetical. The chase list." },
  {
    value: "owner",
    label: "By owner",
    hint: "Grouped by owner code, with what each owner collects.",
  },
] as const;

export function ListExport({
  participants,
  blocks,
  config,
}: {
  participants: ParticipantWithFinance[];
  blocks: AdminBlock[];
  config: PoolConfig;
}) {
  const [view, setView] = useState<View>("name");

  const byName = useMemo(() => {
    // One entry per committed block per participant, alphabetical by the
    // display name (stable). Numbered blocks first (ascending), then
    // unnumbered slots for any remaining requested blocks.
    const byName = [...participants].sort((a, b) =>
      (a.display_alias ?? a.full_name).localeCompare(
        b.display_alias ?? b.full_name,
      ),
    );
    const entries: { name: string; blockNumber: number | null }[] = [];
    for (const p of byName) {
      const name = p.display_alias ?? p.full_name;
      const numbered = blocks
        .filter((b) => b.participant_id === p.id)
        .map((b) => b.block_number)
        .sort((a, b) => a - b);
      for (const n of numbered) entries.push({ name, blockNumber: n });
      for (let i = numbered.length; i < p.blocks_requested; i++) {
        entries.push({ name, blockNumber: null });
      }
    }
    return buildListExport(2026, entries);
  }, [participants, blocks]);

  // Grouped by owner code: who collects what, and how much of it.
  const byOwner = useMemo(
    () =>
      buildGroupedList(
        2026,
        groupedRoster(
          participants,
          blocks,
          config.price_per_block_cents,
          config.blocks_total,
        ),
      ),
    [participants, blocks, config],
  );

  const text = view === "name" ? byName : byOwner;
  const lineCount = text.split("\n").length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed — long-press the text and copy manually.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl">List</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {VIEWS.find((v) => v.value === view)?.hint} Plain text, pastes
            clean into the group chat.
          </p>
        </div>
        <Button className="shrink-0" onClick={copy}>
          <Copy data-icon="inline-start" />
          Copy
        </Button>
      </div>

      <div
        role="radiogroup"
        aria-label="List view"
        className="inline-flex rounded-lg border border-border bg-surface p-0.5"
      >
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="radio"
            aria-checked={view === v.value}
            onClick={() => setView(v.value)}
            className={cn(
              "h-8 rounded-md px-3 text-xs font-semibold tracking-wide uppercase transition-colors duration-150",
              view === v.value
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-4 font-mono text-sm">
          {text}
        </pre>
        <p className="text-2xs text-muted-foreground" data-numeric>
          {lineCount} lines
        </p>
      </div>
    </div>
  );
}
