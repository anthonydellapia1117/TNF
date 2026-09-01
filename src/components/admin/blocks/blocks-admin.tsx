"use client";

import {
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
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
  confirmCarryover,
  holdBlock,
  promoteParticipant,
  releaseBlock,
  reserveBlocks,
  setBlockName,
  setComped,
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
  // F7: roving tabindex — one cell is tabbable, arrows move focus.
  const [focusedIndex, setFocusedIndex] = useState(0);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

  const compedCount = useMemo(
    () => blocks.filter((b) => b.comped).length,
    [blocks],
  );

  // H1: carried-over numbers nobody has re-confirmed yet.
  const unconfirmedCarryovers = useMemo(
    () =>
      blocks.filter(
        (b) =>
          b.assignment_method === "carryover" &&
          (b.notes ?? "").toLowerCase().includes("unconfirmed"),
      ),
    [blocks],
  );

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
  // Comping needs an owner — an unowned block has nobody to comp.
  const selOwned = selectedList.filter(
    (n) => byNumber.get(n)?.participant_id != null,
  );
  const selToComp = selOwned.filter((n) => !byNumber.get(n)?.comped);
  const selToUncomp = selOwned.filter((n) => byNumber.get(n)?.comped);

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

  function onComp(comped: boolean) {
    const targets = comped ? selToComp : selToUncomp;
    const verb = comped ? "Comped" : "Un-comped";
    startTransition(async () => {
      let failed: string | null = null;
      let done = 0;
      for (const n of targets) {
        const result = await setComped(n, comped);
        if (!result.ok) {
          failed = result.error ?? `Block ${n} would not update.`;
          break;
        }
        done++;
      }
      if (failed) {
        toast.error(
          done > 0 ? `${verb} ${done}, then failed: ${failed}` : failed,
        );
      } else {
        toast.success(`${verb} ${done} block${plural(done)}`);
        setSelected(new Set());
      }
      router.refresh();
    });
  }

  function onNameBlock(n: number) {
    const b = byNumber.get(n);
    if (!b) return;
    const current = b.display_name ?? "";
    const next = window.prompt(
      `Name for block ${n}?\n\nThis block shows this name instead of the owner's alias. `
        + `Leave it empty to fall back to the alias. Money is unaffected — the owner still owes once.`,
      current,
    );
    if (next === null) return; // cancelled
    startTransition(async () => {
      const result = await setBlockName(n, next);
      if (result.ok) {
        toast.success(
          next.trim()
            ? `Block ${n} now reads "${next.trim()}"`
            : `Block ${n} falls back to the owner's alias`,
        );
        setSelected(new Set());
      } else {
        toast.error(result.error ?? "Could not set the name.");
      }
      router.refresh();
    });
  }

  function onConfirmCarryover(n: number) {
    startTransition(async () => {
      const result = await confirmCarryover(n);
      if (result.ok) {
        toast.success(`Block ${n} confirmed as requested`);
      } else {
        toast.error(result.error ?? "Confirm failed.");
      }
      router.refresh();
    });
  }

  function onReleaseCarryover(n: number) {
    if (
      !window.confirm(
        `Release block ${n} back to the pool? This frees the number but keeps its history.`,
      )
    )
      return;
    startTransition(async () => {
      const result = await releaseBlock(n);
      if (result.ok) {
        toast.success(`Block ${n} released to the pool`);
      } else {
        toast.error(result.error ?? "Release failed.");
      }
      router.refresh();
    });
  }

  // F7: arrows move within the 10x10 grid, Space/Enter toggles selection.
  function onCellKeyDown(
    e: KeyboardEvent<HTMLButtonElement>,
    i: number,
    n: number,
  ) {
    let next: number;
    switch (e.key) {
      case "ArrowLeft":
        next = i - 1;
        break;
      case "ArrowRight":
        next = i + 1;
        break;
      case "ArrowUp":
        next = i - 10;
        break;
      case "ArrowDown":
        next = i + 10;
        break;
      case " ":
      case "Enter":
        e.preventDefault(); // keep Space from scrolling the page
        toggle(n);
        return;
      default:
        return;
    }
    e.preventDefault();
    const clamped = Math.max(0, Math.min(blocks.length - 1, next));
    setFocusedIndex(clamped);
    cellRefs.current[clamped]?.focus();
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
          {compedCount > 0 ? ` · ${compedCount} comped` : ""}
        </p>
      </div>

      {/* H1: carried-over numbers still waiting on a yes from the group */}
      {unconfirmedCarryovers.length > 0 ? (
        <div className="rounded-lg border border-halftime/60 bg-surface p-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-halftime">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            Carryover numbers awaiting confirmation
          </h2>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            Waiting on confirmation that these carried-over numbers are what
            the group actually wants.
          </p>
          <div className="mt-2 divide-y divide-border">
            {unconfirmedCarryovers.map((b) => {
              const alias = b.participant_id
                ? aliasById.get(b.participant_id)
                : undefined;
              return (
                <div
                  key={b.block_number}
                  className="space-y-1.5 py-2 first:pt-0 last:pb-0"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 text-sm font-medium" data-numeric>
                      #{b.block_number}
                    </span>
                    <span className="truncate text-sm">{alias ?? "—"}</span>
                    {b.notes ? (
                      <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                        {b.notes}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-9 min-w-0 flex-1 sm:h-7 sm:flex-none"
                      disabled={isPending}
                      onClick={() => onConfirmCarryover(b.block_number)}
                    >
                      <span className="truncate">Confirm as requested</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 min-w-0 flex-1 sm:h-7 sm:flex-none"
                      disabled={isPending}
                      onClick={() => onReleaseCarryover(b.block_number)}
                    >
                      <span className="truncate">Release to pool</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

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
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-final" />
            <span className="text-final">Requested number</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-bold text-primary">C</span>
            <span className="text-primary">Comped — owes $0, still wins</span>
          </span>
        </div>

        <div
          role="grid"
          aria-label="Block selection grid — arrow keys move between blocks, Space or Enter toggles selection"
          className="grid grid-cols-10 gap-0.5 sm:gap-1"
        >
          {blocks.map((b, i) => {
            const isSelected = selected.has(b.block_number);
            const alias = b.participant_id
              ? aliasById.get(b.participant_id)
              : undefined;
            const disputed = /disput/i.test(b.notes ?? "");
            return (
              <button
                key={b.block_number}
                ref={(el) => {
                  cellRefs.current[i] = el;
                }}
                type="button"
                tabIndex={i === focusedIndex ? 0 : -1}
                onFocus={() => setFocusedIndex(i)}
                onKeyDown={(e) => onCellKeyDown(e, i, b.block_number)}
                onClick={() => toggle(b.block_number)}
                aria-pressed={isSelected}
                title={
                  [
                    b.display_name ? `"${b.display_name}"` : null,
                    b.comped ? "COMPED — owes $0, still wins" : null,
                    b.notes,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
                className={cn(
                  "relative flex aspect-square touch-manipulation flex-col items-center justify-center gap-0.5 rounded-md border transition-colors duration-100",
                  CELL[b.status],
                  isSelected && "z-10 bg-primary/10 ring-2 ring-ring ring-inset",
                )}
              >
                {/* H2: note markers — red triangle for disputes, amber dot otherwise */}
                {disputed ? (
                  <TriangleAlert
                    className="absolute top-0.5 right-0.5 size-2.5 text-destructive"
                    aria-hidden
                  />
                ) : b.notes ? (
                  <span
                    className="absolute top-0.5 right-0.5 size-1 rounded-full bg-halftime"
                    aria-hidden
                  />
                ) : null}
                {/* Comped: in play and winnable, owes nothing. Admin only. */}
                {b.comped && (
                  <span
                    className="absolute right-0.5 bottom-0.5 text-[8px] leading-none font-bold text-primary"
                    aria-hidden
                  >
                    C
                  </span>
                )}
                {/* Policy: requested numbers are marked apart from random ones */}
                {b.assignment_method === "requested" && (
                  <span
                    className="absolute bottom-0.5 left-0.5 size-1 rounded-full bg-final"
                    aria-hidden
                  />
                )}
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
          {selOwned.length === 1 ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-12 min-w-0 flex-1 sm:h-8"
                disabled={isPending}
                onClick={() => onNameBlock(selOwned[0])}
              >
                <span className="truncate">
                  {byNumber.get(selOwned[0])?.display_name
                    ? `Rename block ${selOwned[0]}`
                    : `Name block ${selOwned[0]}`}
                </span>
              </Button>
            </div>
          ) : null}
          {selOwned.length > 0 ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-12 min-w-0 flex-1 sm:h-8"
                disabled={isPending || selToComp.length === 0}
                onClick={() => onComp(true)}
              >
                <span className="truncate">
                  Comp{selToComp.length > 0 ? ` ${selToComp.length}` : ""} — $0
                  due, still wins
                </span>
              </Button>
              {selToUncomp.length > 0 ? (
                <Button
                  variant="outline"
                  className="h-12 sm:h-8"
                  disabled={isPending}
                  onClick={() => onComp(false)}
                >
                  Un-comp {selToUncomp.length}
                </Button>
              ) : null}
            </div>
          ) : null}
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
                          title={
                            [
                              b.assignment_method
                                ? `#${b.block_number}: ${b.assignment_method}`
                                : null,
                              b.comped ? "comped — owes $0, still wins" : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || undefined
                          }
                          className={
                            b.status === "reserved"
                              ? "text-halftime"
                              : "text-muted-foreground"
                          }
                        >
                          #{b.block_number}
                          {b.display_name ? (
                            <span className="text-foreground">
                              {" "}
                              {b.display_name}
                            </span>
                          ) : null}
                          {b.assignment_method === "requested" && (
                            <span className="text-final"> req</span>
                          )}
                          {b.comped && (
                            <span className="text-primary"> comp</span>
                          )}
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
