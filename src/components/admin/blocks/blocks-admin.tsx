"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  holdBlock,
  promoteParticipant,
  releaseBlock,
  reserveBlocks,
} from "@/app/admin/actions";
import type { AdminBlock, BlockStatus } from "@/lib/types";
import type { ParticipantWithFinance } from "@/lib/data/admin";

// Cell look per status (spec 4.7): available dashed, reserved amber,
// assigned solid, held dim.
const CELL: Record<BlockStatus, string> = {
  available: "border-dashed border-border text-muted-foreground",
  reserved: "border-halftime/60 text-halftime",
  assigned: "border-border bg-surface-2 text-foreground",
  held: "border-border/40 text-muted-foreground/50",
};

const plural = (n: number) => (n === 1 ? "" : "s");

export function BlocksAdmin({
  blocks,
  participants,
}: {
  blocks: AdminBlock[];
  participants: ParticipantWithFinance[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [participantId, setParticipantId] = useState("");

  const byNumber = useMemo(
    () => new Map(blocks.map((b) => [b.block_number, b])),
    [blocks],
  );
  const aliasById = useMemo(
    () =>
      new Map(
        participants.map((p) => [p.id, p.display_alias ?? p.full_name]),
      ),
    [participants],
  );
  const blocksByParticipant = useMemo(() => {
    const m = new Map<string, AdminBlock[]>();
    for (const b of blocks) {
      if (!b.participant_id) continue;
      const list = m.get(b.participant_id) ?? [];
      list.push(b);
      m.set(b.participant_id, list);
    }
    return m;
  }, [blocks]);

  const counts = useMemo(() => {
    const c = { available: 0, reserved: 0, assigned: 0, held: 0 };
    for (const b of blocks) c[b.status]++;
    return c;
  }, [blocks]);

  const sortedParticipants = useMemo(
    () =>
      [...participants].sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [participants],
  );

  const selectedList = useMemo(
    () => Array.from(selected).sort((a, b) => a - b),
    [selected],
  );
  const selAvailable = selectedList.filter(
    (n) => byNumber.get(n)?.status === "available",
  );
  const selTaken = selectedList.filter(
    (n) => byNumber.get(n)?.status !== "available",
  );

  const chosenAlias = participantId ? aliasById.get(participantId) : undefined;
  const canReserve =
    selectedList.length > 0 &&
    selTaken.length === 0 &&
    participantId !== "" &&
    !isPending;

  function toggle(n: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  function onReserve() {
    const numbers = selectedList;
    startTransition(async () => {
      const result = await reserveBlocks({
        blockNumbers: numbers,
        participantId,
        method: "requested",
        ref: "",
      });
      if (result.ok) {
        toast.success(
          `Reserved ${numbers.length} block${plural(numbers.length)} for ${chosenAlias}`,
        );
        setSelected(new Set());
      } else {
        toast.error(result.error ?? "Reserve failed.");
      }
      router.refresh();
    });
  }

  function onRelease() {
    const targets = selTaken;
    startTransition(async () => {
      let failed: string | null = null;
      let done = 0;
      for (const n of targets) {
        const result = await releaseBlock(n);
        if (!result.ok) {
          failed = result.error ?? `Block ${n} would not release.`;
          break;
        }
        done++;
      }
      if (failed) {
        toast.error(
          done > 0 ? `Released ${done}, then failed: ${failed}` : failed,
        );
      } else {
        toast.success(`Released ${done} block${plural(done)}`);
        setSelected(new Set());
      }
      router.refresh();
    });
  }

  function onHold() {
    const targets = selAvailable;
    startTransition(async () => {
      let failed: string | null = null;
      let done = 0;
      for (const n of targets) {
        const result = await holdBlock(n, "");
        if (!result.ok) {
          failed = result.error ?? `Block ${n} would not hold.`;
          break;
        }
        done++;
      }
      if (failed) {
        toast.error(done > 0 ? `Held ${done}, then failed: ${failed}` : failed);
      } else {
        toast.success(`Held ${done} block${plural(done)}`);
        setSelected(new Set());
      }
      router.refresh();
    });
  }

  function onPromote(p: ParticipantWithFinance) {
    const alias = p.display_alias ?? p.full_name;
    startTransition(async () => {
      const result = await promoteParticipant(p.id);
      if (result.ok) {
        const n = typeof result.data === "number" ? result.data : null;
        toast.success(
          n != null
            ? `${alias} assigned — ${n} block${plural(n)} promoted`
            : `${alias} promoted to assigned`,
        );
      } else {
        toast.error(result.error ?? "Promote failed.");
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl">Blocks</h1>
        <p className="mt-0.5 text-sm text-muted-foreground" data-numeric>
          {counts.available} open · {counts.reserved} reserved ·{" "}
          {counts.assigned} assigned · {counts.held} held
        </p>
      </div>

      {/* Grid card: legend + 10x10 mini-grid, toggle-select cells */}
      <div className="rounded-lg border border-border bg-surface p-2 sm:p-3">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-2xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs border border-dashed border-border" />
            Available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs border border-halftime/60" />
            <span className="text-halftime">Reserved</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs border border-border bg-surface-2" />
            Assigned
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs border border-border/40 opacity-50" />
            Held
          </span>
        </div>

        <div className="grid grid-cols-10 gap-0.5 sm:gap-1">
          {blocks.map((b) => {
            const isSelected = selected.has(b.block_number);
            const alias = b.participant_id
              ? aliasById.get(b.participant_id)
              : undefined;
            return (
              <button
                key={b.block_number}
                type="button"
                onClick={() => toggle(b.block_number)}
                aria-pressed={isSelected}
                className={cn(
                  "relative flex aspect-square touch-manipulation flex-col items-center justify-center gap-0.5 rounded-md border transition-colors duration-100",
                  CELL[b.status],
                  isSelected && "z-10 bg-primary/10 ring-2 ring-ring ring-inset",
                )}
              >
                <span className="text-2xs leading-none" data-numeric>
                  {b.block_number}
                </span>
                {alias ? (
                  <span className="text-[9px] leading-none uppercase opacity-80">
                    {alias.charAt(0)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Action bar — sticky so it stays in reach while picking cells */}
      <div className="sticky bottom-0 z-20 -mx-1 bg-background/90 px-1 py-2 backdrop-blur">
        <div className="space-y-2 rounded-lg border border-border bg-surface p-2">
          <div className="flex items-center gap-2">
            <span
              className="shrink-0 text-sm text-muted-foreground"
              data-numeric
            >
              {selectedList.length} selected
            </span>
            {selectedList.length > 0 ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setSelected(new Set())}
                disabled={isPending}
              >
                Clear
              </Button>
            ) : null}
            <div className="min-w-0 flex-1">
              <Select value={participantId} onValueChange={setParticipantId}>
                <SelectTrigger className="h-12 w-full sm:h-8">
                  <SelectValue placeholder="Pick a participant…" />
                </SelectTrigger>
                <SelectContent>
                  {sortedParticipants.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.display_alias
                        ? `${p.display_alias} (${p.full_name})`
                        : p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              className="h-12 min-w-0 flex-1 sm:h-8"
              disabled={!canReserve}
              onClick={onReserve}
            >
              <span className="truncate">
                {chosenAlias ? `Reserve for ${chosenAlias}` : "Reserve"}
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-12 sm:h-8"
              disabled={isPending || selTaken.length === 0}
              onClick={onRelease}
            >
              Release{selTaken.length > 0 ? ` ${selTaken.length}` : ""}
            </Button>
            <Button
              variant="outline"
              className="h-12 sm:h-8"
              disabled={isPending || selAvailable.length === 0}
              onClick={onHold}
            >
              Hold{selAvailable.length > 0 ? ` ${selAvailable.length}` : ""}
            </Button>
          </div>
        </div>
      </div>

      {/* Per-participant summary: requested vs held, paid vs due, promote */}
      <ParticipantSummary
        participants={sortedParticipants}
        blocksByParticipant={blocksByParticipant}
        isPending={isPending}
        onPromote={onPromote}
      />
    </div>
  );
}

function ParticipantSummary({
  participants,
  blocksByParticipant,
  isPending,
  onPromote,
}: {
  participants: ParticipantWithFinance[];
  blocksByParticipant: Map<string, AdminBlock[]>;
  isPending: boolean;
  onPromote: (p: ParticipantWithFinance) => void;
}) {
  const rows = participants.filter(
    (p) =>
      p.blocks_requested > 0 || (blocksByParticipant.get(p.id)?.length ?? 0) > 0,
  );

  return (
    <div>
      <h2 className="mb-2 text-lg">Buyers</h2>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
          No requests or holdings yet.
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((p) => {
            const alias = p.display_alias ?? p.full_name;
            const held = (blocksByParticipant.get(p.id) ?? []).sort(
              (a, b) => a.block_number - b.block_number,
            );
            const hasReserved = held.some((b) => b.status === "reserved");
            const paid = p.finance.amount_paid_cents;
            const due = p.finance.amount_due_cents;
            const fullyPaid = paid >= due;
            const canPromote = fullyPaid && hasReserved;
            return (
              <div
                key={p.id}
                className="flex min-h-12 items-start justify-between gap-3 px-3 py-2.5 sm:min-h-10"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">
                      {alias}
                    </span>
                    <span
                      className="shrink-0 text-2xs text-muted-foreground"
                      data-numeric
                    >
                      asked {p.blocks_requested}
                    </span>
                  </div>
                  <div
                    className="mt-0.5 flex flex-wrap gap-x-1.5 gap-y-0.5 text-2xs"
                    data-numeric
                  >
                    {held.length === 0 ? (
                      <span className="text-muted-foreground">
                        no blocks yet
                      </span>
                    ) : (
                      held.map((b) => (
                        <span
                          key={b.block_number}
                          className={
                            b.status === "reserved"
                              ? "text-halftime"
                              : "text-muted-foreground"
                          }
                        >
                          #{b.block_number}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span
                    className={cn(
                      "text-sm",
                      fullyPaid ? "text-muted-foreground" : "text-halftime",
                    )}
                    data-numeric
                  >
                    {fmtUsd(paid)} / {fmtUsd(due)}
                  </span>
                  {canPromote ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 sm:h-7"
                      disabled={isPending}
                      onClick={() => onPromote(p)}
                    >
                      Promote to Assigned
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
