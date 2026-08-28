"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Search,
  StickyNote,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import {
  OWNER_GROUPS,
  type AdminBlock,
  type OwnerGroup,
  type ParticipantFinance,
  type Payment,
} from "@/lib/types";
import type { ParticipantWithFinance } from "@/lib/data/admin";
import { promoteParticipant, upsertParticipant } from "@/app/admin/actions";
import {
  compareValues,
  useTableSort,
  type TableSort,
} from "@/components/admin/use-table-sort";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ParticipantDialog } from "@/components/admin/participants/participant-dialog";

const SOURCE_LABEL: Record<ParticipantWithFinance["source"], string> = {
  email: "Email",
  text: "Text",
  in_person: "In person",
  import: "Import",
};

/** Spec 4.7: green paid-in-full, amber partial, red zero-paid. */
function balanceClass(f: ParticipantFinance): string {
  if (f.amount_due_cents <= 0) return "text-muted-foreground";
  if (f.amount_paid_cents >= f.amount_due_cents) return "text-emerald-400";
  if (f.amount_paid_cents === 0) return "text-destructive";
  return "text-halftime";
}

function canPromote(f: ParticipantFinance): boolean {
  return (
    f.amount_paid_cents >= f.amount_due_cents &&
    f.amount_due_cents > 0 &&
    f.blocks_held > f.blocks_assigned
  );
}

/** H2: a note containing "disput" (Rob Gambino) must scream from the list. */
function disputeNote(notes: string | null): string | null {
  return notes && /disput/i.test(notes) ? notes : null;
}

// F1/F2: sortable columns on the desktop table, applied after search.
const SORT_KEYS = [
  "name",
  "alias",
  "group",
  "held",
  "due",
  "paid",
  "balance",
] as const;
type SortKey = (typeof SORT_KEYS)[number];

function sortValue(p: ParticipantWithFinance, key: SortKey): unknown {
  switch (key) {
    case "name":
      return p.full_name;
    case "alias":
      return p.display_alias;
    case "group":
      return p.owner_group;
    case "held":
      return p.finance.blocks_held;
    case "due":
      return p.finance.amount_due_cents;
    case "paid":
      return p.finance.amount_paid_cents;
    case "balance":
      return p.finance.amount_due_cents - p.finance.amount_paid_cents;
  }
}

function SortHead({
  label,
  k,
  sort,
  onToggle,
  align,
}: {
  label: string;
  k: SortKey;
  sort: TableSort<SortKey>;
  onToggle: (key: SortKey) => void;
  align?: "right";
}) {
  const active = sort.key === k;
  const Chevron = sort.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onToggle(k)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors duration-150 hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        {active && <Chevron className="size-3" />}
      </button>
    </TableHead>
  );
}

export function ParticipantsClient({
  participants,
  blocks,
  payments,
}: {
  participants: ParticipantWithFinance[];
  blocks: AdminBlock[];
  payments: Payment[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Quick-add row
  const [qaName, setQaName] = useState("");
  const [qaAlias, setQaAlias] = useState("");
  const [qaGroup, setQaGroup] = useState<OwnerGroup>("AVD");
  const [qaBlocks, setQaBlocks] = useState("1");

  // Search + edit dialog
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ParticipantWithFinance | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [sort, toggleSort] = useTableSort<SortKey>(SORT_KEYS, {
    key: "name",
    dir: "asc",
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return participants;
    return participants.filter(
      (p) =>
        p.full_name.toLowerCase().includes(q) ||
        (p.display_alias ?? "").toLowerCase().includes(q),
    );
  }, [participants, search]);

  // Sort applies after the search filter (F1).
  const sorted = useMemo(() => {
    const mult = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort(
      (a, b) => mult * compareValues(sortValue(a, sort.key), sortValue(b, sort.key)),
    );
  }, [filtered, sort]);

  function openEdit(p: ParticipantWithFinance | null) {
    setEditing(p);
    setDialogOpen(true);
  }

  function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = qaName.trim();
    if (!name) {
      toast.error("Name is required.");
      return;
    }
    startTransition(async () => {
      const result = await upsertParticipant({
        id: null,
        full_name: name,
        display_alias: qaAlias.trim(),
        email: "",
        phone: "",
        owner_group: qaGroup,
        shared_group_id: "",
        source: "text",
        source_ref: "",
        blocks_requested: Math.max(0, parseInt(qaBlocks, 10) || 0),
        notes: "",
      });
      if (result.ok) {
        toast.success(`Added ${name}`);
        setQaName("");
        setQaAlias("");
        setQaBlocks("1");
        router.refresh();
      } else {
        toast.error(result.error ?? "Could not add participant.");
      }
    });
  }

  function promote(p: ParticipantWithFinance) {
    startTransition(async () => {
      const result = await promoteParticipant(p.id);
      if (result.ok) {
        const n = result.data ?? 0;
        toast.success(
          `Promoted ${n} block${n === 1 ? "" : "s"} for ${p.display_alias || p.full_name}`,
        );
        router.refresh();
      } else {
        toast.error(result.error ?? "Promote failed.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl">Participants</h1>
        <p className="mt-0.5 text-sm text-muted-foreground" data-numeric>
          {participants.length} in the pool. Tap a row to edit.
        </p>
      </div>

      {/* Quick-add: one-thumb flow */}
      <form
        onSubmit={quickAdd}
        className="rounded-lg border border-border bg-surface p-3"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={qaName}
            onChange={(e) => setQaName(e.target.value)}
            placeholder="Full name"
            autoComplete="off"
            className="h-12 sm:h-8 sm:flex-1"
          />
          <div className="flex items-center gap-2">
            <Input
              value={qaAlias}
              onChange={(e) => setQaAlias(e.target.value)}
              placeholder="Alias"
              autoComplete="off"
              className="h-12 min-w-0 flex-1 sm:h-8 sm:w-28 sm:flex-none"
            />
            <Select
              value={qaGroup}
              onValueChange={(v) => setQaGroup(v as OwnerGroup)}
            >
              <SelectTrigger className="h-12 w-24 shrink-0 sm:h-8" aria-label="Group">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OWNER_GROUPS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={qaBlocks}
              onChange={(e) => setQaBlocks(e.target.value)}
              aria-label="Blocks requested"
              className="h-12 w-16 shrink-0 sm:h-8"
              data-numeric
            />
            <Button
              type="submit"
              disabled={pending || !qaName.trim()}
              className="h-12 shrink-0 sm:h-8"
            >
              <Plus data-icon="inline-start" />
              Add
            </Button>
          </div>
        </div>
      </form>

      {/* Search + full-form add */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or alias"
            className="h-12 pl-8 sm:h-8"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => openEdit(null)}
          className="h-12 shrink-0 sm:h-8"
        >
          <UserPlus data-icon="inline-start" />
          New
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
          {participants.length === 0
            ? "No participants yet. Add the first one above."
            : "No matches."}
        </div>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-2 md:hidden">
            {sorted.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => openEdit(p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openEdit(p);
                }}
                className="cursor-pointer rounded-lg border border-border bg-surface p-3 transition-colors duration-150 hover:bg-surface-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.full_name}</p>
                    {p.display_alias && (
                      <p className="truncate text-xs text-muted-foreground">
                        {p.display_alias}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {disputeNote(p.notes) && (
                      <span title={p.notes ?? undefined}>
                        <TriangleAlert className="size-3.5 text-destructive" />
                      </span>
                    )}
                    {p.notes && (
                      <StickyNote className="size-3.5 text-muted-foreground" />
                    )}
                    <Badge variant="outline">{p.owner_group}</Badge>
                  </div>
                </div>
                <div
                  className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
                  data-numeric
                >
                  <span>
                    {p.finance.blocks_held} held · {p.finance.blocks_assigned}{" "}
                    assigned
                  </span>
                  <span>{fmtUsd(p.finance.amount_due_cents)} due</span>
                  {p.finance.blocks_comped > 0 ? (
                    <span className="text-primary">
                      {p.finance.blocks_comped} comped
                    </span>
                  ) : null}
                  <span>{fmtUsd(p.finance.amount_paid_cents)} paid</span>
                  <span className={cn("font-medium", balanceClass(p.finance))}>
                    {fmtUsd(
                      p.finance.amount_due_cents - p.finance.amount_paid_cents,
                    )}{" "}
                    open
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-2xs tracking-widest text-muted-foreground uppercase">
                    {SOURCE_LABEL[p.source]}
                  </span>
                  {canPromote(p.finance) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={(e) => {
                        e.stopPropagation();
                        promote(p);
                      }}
                      className="h-9"
                    >
                      Promote
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: dense table */}
          <div className="hidden rounded-lg border border-border bg-surface md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortHead label="Name" k="name" sort={sort} onToggle={toggleSort} />
                  <SortHead label="Alias" k="alias" sort={sort} onToggle={toggleSort} />
                  <SortHead label="Group" k="group" sort={sort} onToggle={toggleSort} />
                  <SortHead
                    label="Blocks"
                    k="held"
                    sort={sort}
                    onToggle={toggleSort}
                    align="right"
                  />
                  <SortHead
                    label="Due"
                    k="due"
                    sort={sort}
                    onToggle={toggleSort}
                    align="right"
                  />
                  <SortHead
                    label="Paid"
                    k="paid"
                    sort={sort}
                    onToggle={toggleSort}
                    align="right"
                  />
                  <SortHead
                    label="Balance"
                    k="balance"
                    sort={sort}
                    onToggle={toggleSort}
                    align="right"
                  />
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((p) => (
                  <TableRow
                    key={p.id}
                    onClick={() => openEdit(p)}
                    className="h-10 cursor-pointer"
                  >
                    <TableCell className="max-w-48 truncate font-medium">
                      {p.full_name}
                    </TableCell>
                    <TableCell className="max-w-32 truncate text-muted-foreground">
                      {p.display_alias ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.owner_group}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.finance.blocks_held}/{p.finance.blocks_assigned}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtUsd(p.finance.amount_due_cents)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtUsd(p.finance.amount_paid_cents)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium",
                        balanceClass(p.finance),
                      )}
                    >
                      {fmtUsd(
                        p.finance.amount_due_cents - p.finance.amount_paid_cents,
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {SOURCE_LABEL[p.source]}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {disputeNote(p.notes) && (
                          <span title={p.notes ?? undefined}>
                            <TriangleAlert className="size-3.5 text-destructive" />
                          </span>
                        )}
                        {p.notes && (
                          <StickyNote className="size-3.5 text-muted-foreground" />
                        )}
                        {canPromote(p.finance) && (
                          <Button
                            size="xs"
                            variant="secondary"
                            disabled={pending}
                            onClick={(e) => {
                              e.stopPropagation();
                              promote(p);
                            }}
                          >
                            Promote
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <ParticipantDialog
        participant={editing}
        blocks={blocks}
        payments={payments}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
