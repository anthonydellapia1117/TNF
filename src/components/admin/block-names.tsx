"use client";

// Blocks carrying their own name, and the places where naming is still
// working around not having had one. Nothing here changes on its own —
// renaming someone is Anthony's call.

import { Tag, TriangleAlert } from "lucide-react";
import type { BlockNameCandidate } from "@/lib/block-names";

export function BlockNames({
  named,
  candidates,
}: {
  named: { block_number: number; display_name: string }[];
  candidates: BlockNameCandidate[];
}) {
  if (named.length === 0 && candidates.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs font-semibold tracking-widest text-muted-foreground uppercase">
        <Tag className="size-3.5 shrink-0" aria-hidden />
        Block names
        <span className="rounded border border-border px-1 py-px text-[9px] tracking-normal normal-case">
          admin only
        </span>
      </h2>

      {named.length > 0 ? (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            These blocks carry their own name instead of their owner&apos;s
            alias. Money is unaffected — the owner still owes once.
          </p>
          <ul className="mb-4 space-y-1">
            {named.map((n) => (
              <li
                key={n.block_number}
                className="flex items-baseline gap-2 text-sm"
              >
                <span className="text-muted-foreground" data-numeric>
                  #{n.block_number}
                </span>
                <span className="font-medium">{n.display_name}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {candidates.length > 0 ? (
        <div className="rounded-md border border-halftime/50 bg-surface-2 p-3">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-halftime">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            Candidates for a per-block name
          </h3>
          <p className="mb-2 text-2xs text-muted-foreground">
            These were named the way they are because a block could not carry
            its own name. It can now. Nothing has been changed.
          </p>
          <ul className="space-y-2">
            {candidates.map((c) => (
              <li key={c.aliases.join("|")} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-medium">{c.aliases.join(" · ")}</span>
                  <span className="text-2xs text-muted-foreground" data-numeric>
                    {c.blocks.map((b) => `#${b}`).join(", ")}
                  </span>
                </div>
                <p className="text-2xs text-muted-foreground">{c.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
