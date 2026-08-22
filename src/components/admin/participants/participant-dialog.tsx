"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { fmtUsd } from "@/lib/format";
import {
  OWNER_GROUPS,
  type OwnerGroup,
  type Participant,
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
  open,
  onOpenChange,
}: {
  participant: ParticipantWithFinance | null;
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
              ? `${f.blocks_held} held · ${f.blocks_assigned} assigned · ${fmtUsd(f.amount_due_cents)} due · ${fmtUsd(f.amount_paid_cents)} paid`
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
