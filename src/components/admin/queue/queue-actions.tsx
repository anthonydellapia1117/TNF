"use client";

// The two buttons on a queue row. Approve and Dismiss each call one server
// action, which calls one RPC; the row disappears on refresh because the
// page lists open items only.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { approvePending, dismissPending } from "@/app/admin/actions";
import { dispatchFor } from "@/lib/pending";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function QueueActions({ id, kind }: { id: string; kind: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const dispatch = dispatchFor(kind);

  const approve = () => {
    startTransition(async () => {
      const res = await approvePending(id, note);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.data?.applied
          ? `Approved and applied through ${res.data.dispatched_to}.`
          : "Approved. Nothing was applied - do it by hand from the admin pages.",
      );
      router.refresh();
    });
  };

  const dismiss = () => {
    startTransition(async () => {
      const res = await dismissPending(id, note);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Dismissed. Nothing changed.");
      router.refresh();
    });
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          aria-label="Resolution note"
          autoComplete="off"
          className="h-8 max-w-xs"
        />
        <Button size="sm" disabled={pending} onClick={approve}>
          {pending ? "Saving…" : "Approve"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={dismiss}>
          Dismiss
        </Button>
      </div>
      <p className="text-2xs text-muted-foreground">{dispatch.onApprove}</p>
    </div>
  );
}
