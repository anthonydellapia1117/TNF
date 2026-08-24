"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtDateOnly, fmtUsd } from "@/lib/format";
import {
  OWNER_GROUPS,
  type AdminBlock,
  type BlockStatus,
  type OwnerGroup,
  type Participant,
  type Payment,
} from "@/lib/types";
import type { ParticipantWithFinance } from "@/lib/data/admin";
import { upsertParticipant } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Source = Participant["source"];

const SOURCES: { value: Source; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "text", label: "Text" },
  { value: "in_person", label: "In person" },
  { value: "import", label: "Import" },
];

// Chip look per block status — same language as the blocks board (spec 4.7).
const BLOCK_CHIP: Record<BlockStatus, string> = {
  available: "border-dashed border-border text-muted-foreground",
  reserved: "border-halftime/60 text-halftime",
  assigned: "border-border bg-surface-2 text-foreground",
  held: "border-border/40 text-muted-foreground/50",
};

interface FormState {
  full_name: string;
  display_alias: string;
  email: string;
  phone: string;
  owner_group: OwnerGroup;
  shared_group_id: string;
  source: Source;
  source_ref: string;
  blocks_requested: string;
  notes: string;
}

const BLANK: FormState = {
  full_name: "",
  display_alias: "",
  email: "",
  phone: "",
  owner_group: "DIRECT",
  shared_group_id: "",
  source: "text",
  source_ref: "",
  blocks_requested: "1",
  notes: "",
};

export function ParticipantDialog({
  participant,
  blocks,
  payments,
  open,
  onOpenChange,
}: {
  participant: ParticipantWithFinance | null;
  blocks: AdminBlock[];
  payments: Payment[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(BLANK);

  useEffect(() => {
    if (!open) return;
    setForm(
      participant
        ? {
            full_name: participant.full_name,
            display_alias: participant.display_alias ?? "",
            email: participant.email ?? "",
            phone: participant.phone ?? "",
            owner_group: participant.owner_group,
            shared_group_id: participant.shared_group_id ?? "",
            source: participant.source,
            source_ref: participant.source_ref ?? "",
            blocks_requested: String(participant.blocks_requested),
            notes: participant.notes ?? "",
          }
        : BLANK,
    );
  }, [open, participant]);

  // F3: the drawer is the whole story — this person's blocks and money,
  // read-only, below the editable fields.
  const myBlocks = useMemo(
    () =>
      participant
        ? blocks.filter((b) => b.participant_id === participant.id)
        : [],
    [blocks, participant],
  );
  const myPayments = useMemo(
    () =>
      participant
        ? payments.filter((pm) => pm.participant_id === participant.id)
        : [],
    [payments, participant],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      toast.error("Name is required.");
      return;
    }
    startTransition(async () => {
      const result = await upsertParticipant({
        id: participant?.id ?? null,
        full_name: form.full_name.trim(),
        display_alias: form.display_alias.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        owner_group: form.owner_group,
        shared_group_id: form.shared_group_id.trim(),
        source: form.source,
        source_ref: form.source_ref.trim(),
        blocks_requested: Math.max(0, parseInt(form.blocks_requested, 10) || 0),
        notes: form.notes.trim(),
      });
      if (result.ok) {
        toast.success(
          participant
            ? `Saved ${form.full_name.trim()}`
            : `Added ${form.full_name.trim()}`,
        );
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Save failed.");
      }
    });
  }

  const f = participant?.finance;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {participant ? "Edit participant" : "New participant"}
          </DialogTitle>
          <DialogDescription data-numeric>
            {f
              ? `${f.blocks_held} held · ${f.blocks_assigned} assigned · ${fmtUsd(f.amount_due_cents)} due · ${fmtUsd(f.amount_paid_cents)} paid · ${fmtUsd(f.amount_due_cents - f.amount_paid_cents)} open`
              : "Full record — the quick-add row covers the common case."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={save} className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="p-name">Full name</Label>
            <Input
              id="p-name"
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-alias">Alias</Label>
            <Input
              id="p-alias"
              value={form.display_alias}
              onChange={(e) => set("display_alias", e.target.value)}
              autoComplete="off"
              placeholder="Shown on the grid"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-group">Group</Label>
            <Select
              value={form.owner_group}
              onValueChange={(v) => set("owner_group", v as OwnerGroup)}
            >
              <SelectTrigger id="p-group" className="w-full">
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-email">Email</Label>
            <Input
              id="p-email"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              autoComplete="off"
            />
            {/* F4: informational only — never blocks save. */}
            {!form.email.trim() && (
              <p className="text-2xs text-halftime">
                No email — fine for text/in-person signups, but they won&apos;t
                get pool emails.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-phone">Phone</Label>
            <Input
              id="p-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-source">Source</Label>
            <Select
              value={form.source}
              onValueChange={(v) => set("source", v as Source)}
            >
              <SelectTrigger id="p-source" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-source-ref">Source ref</Label>
            <Input
              id="p-source-ref"
              value={form.source_ref}
              onChange={(e) => set("source_ref", e.target.value)}
              autoComplete="off"
              placeholder="Msg / thread ref"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-shared-group">Shared group id</Label>
            <Input
              id="p-shared-group"
              value={form.shared_group_id}
              onChange={(e) => set("shared_group_id", e.target.value)}
              autoComplete="off"
              placeholder="Splits a block"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-blocks">Blocks requested</Label>
            <Input
              id="p-blocks"
              type="number"
              min={0}
              inputMode="numeric"
              value={form.blocks_requested}
              onChange={(e) => set("blocks_requested", e.target.value)}
              data-numeric
            />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="p-notes">Notes</Label>
            <textarea
              id="p-notes"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            />
          </div>

          {participant && (
            <>
              {/* F3: their blocks, read-only */}
              <div className="col-span-2 space-y-1.5 border-t border-border pt-3">
                <p className="text-2xs tracking-widest text-muted-foreground uppercase">
                  Blocks
                </p>
                {myBlocks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No blocks yet.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {myBlocks.map((b) => (
                      <span
                        key={b.block_number}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-semibold whitespace-nowrap",
                          BLOCK_CHIP[b.status],
                        )}
                        data-numeric
                      >
                        #{b.block_number}
                        <span className="font-normal tracking-wide uppercase">
                          {b.status}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* F3: their payment rows, read-only — the ledger records */}
              <div className="col-span-2 space-y-1.5">
                <p className="text-2xs tracking-widest text-muted-foreground uppercase">
                  Payments
                </p>
                {myPayments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No payments recorded.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {myPayments.map((pm) => (
                      <li
                        key={pm.id}
                        className="flex items-center gap-2 px-2.5 py-1.5 text-xs"
                      >
                        <span
                          className="shrink-0 text-muted-foreground"
                          data-numeric
                        >
                          {fmtDateOnly(pm.paid_on)}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 font-medium",
                            pm.amount_cents < 0 && "text-destructive",
                          )}
                          data-numeric
                        >
                          {fmtUsd(pm.amount_cents)}
                        </span>
                        <span className="shrink-0 text-muted-foreground capitalize">
                          {pm.method}
                        </span>
                        {pm.venmo_txn_id && (
                          <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">
                            {pm.venmo_txn_id}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          <DialogFooter className="col-span-2 mt-1">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || !form.full_name.trim()}>
              {pending ? "Saving…" : participant ? "Save changes" : "Add participant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
