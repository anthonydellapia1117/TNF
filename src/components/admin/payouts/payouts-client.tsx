"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtDateET, fmtDateOnly, fmtUsd } from "@/lib/format";
import { gameCode, winnerMessage } from "@/lib/pool";
import { matchupLabel } from "@/lib/nfl";
import { reopenPayout, settlePayout } from "@/app/admin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AdminGame, Payout } from "@/lib/types";

function todayYmd(): string {
  // en-CA renders as YYYY-MM-DD in the user's local time zone.
  return new Date().toLocaleDateString("en-CA");
}

function buildWinnerMessage(p: Payout, g: AdminGame | undefined): string | null {
  if (!g) return null;
  const half = p.payout_type === "halftime";
  return winnerMessage({
    gameNo: g.game_no,
    payoutType: p.payout_type,
    awayTeam: g.away_team,
    homeTeam: g.home_team,
    awayScore: (half ? g.halftime_away : g.final_away) ?? 0,
    homeScore: (half ? g.halftime_home : g.final_home) ?? 0,
    blockNumber: p.block_number,
    winnerName: p.display_name ?? "Winner",
    amountCents: p.amount_cents,
  });
}

export function PayoutsClient({
  payouts,
  games,
}: {
  payouts: Payout[];
  games: AdminGame[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Mark-paid dialog state.
  const [settling, setSettling] = useState<Payout | null>(null);
  const [paidOn, setPaidOn] = useState(todayYmd());
  const [method, setMethod] = useState("venmo");

  // Winner-message dialog state.
  const [messageFor, setMessageFor] = useState<Payout | null>(null);

  const gameById = new Map(games.map((g) => [g.id, g]));
  const owed = payouts.filter((p) => p.status === "owed");
  const paid = payouts.filter((p) => p.status === "paid");
  const voided = payouts.filter((p) => p.status === "void");
  const owedTotal = owed.reduce((s, p) => s + p.amount_cents, 0);
  const paidTotal = paid.reduce((s, p) => s + p.amount_cents, 0);

  const message = messageFor
    ? buildWinnerMessage(messageFor, gameById.get(messageFor.game_id))
    : null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed — long-press the text and copy manually.");
    }
  };

  const openSettle = (p: Payout) => {
    setPaidOn(todayYmd());
    setMethod("venmo");
    setSettling(p);
  };

  const submitSettle = () => {
    if (!settling) return;
    startTransition(async () => {
      const res = await settlePayout({
        payoutId: settling.id,
        paidOn,
        method,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Marked paid.");
      setSettling(null);
      router.refresh();
    });
  };

  const reopen = (p: Payout) => {
    startTransition(async () => {
      const res = await reopenPayout(p.id, "");
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Payout reopened — back to owed.");
      router.refresh();
    });
  };

  const Row = ({ p }: { p: Payout }) => {
    const g = gameById.get(p.game_id);
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2.5 last:border-b-0",
          p.status === "owed" && "border-l-2 border-l-halftime",
          p.status === "void" && "opacity-50",
        )}
      >
        <span className="text-sm text-muted-foreground" data-numeric>
          {g ? `${gameCode(g.game_no)} ${matchupLabel(g.away_team, g.home_team)}` : "—"}
        </span>
        <Badge
          variant="outline"
          className={cn(
            p.payout_type === "halftime"
              ? "border-halftime/50 bg-halftime/10 text-halftime"
              : "border-final/50 bg-final/10 text-final",
          )}
        >
          {p.payout_type === "halftime" ? "HALF" : "FINAL"}
        </Badge>
        <span className="text-sm text-muted-foreground" data-numeric>
          #{p.block_number}
        </span>
        <span className="text-sm font-medium">
          {p.display_name ?? "Unclaimed"}
        </span>
        <span className="text-sm font-semibold tabular-nums" data-numeric>
          {fmtUsd(p.amount_cents)}
        </span>
        <span className="text-2xs text-muted-foreground" data-numeric>
          {fmtDateET(p.created_at)}
        </span>
        {p.status === "paid" && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-400" data-numeric>
            <CheckCircle2 className="size-3.5" />
            paid {p.paid_on ? fmtDateOnly(p.paid_on) : "—"}
            {p.method ? ` · ${p.method}` : ""}
          </span>
        )}
        {p.status !== "void" && (
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setMessageFor(p)}
            >
              <MessageSquareText data-icon="inline-start" />
              Winner message
            </Button>
            {p.status === "owed" ? (
              <Button size="sm" disabled={pending} onClick={() => openSettle(p)}>
                Mark paid
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => reopen(p)}
              >
                Reopen
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  const Group = ({ title, list }: { title: string; list: Payout[] }) => (
    <div className="space-y-1.5">
      <p className="text-2xs tracking-widest text-muted-foreground uppercase">
        {title}
      </p>
      <div className="rounded-lg border border-border bg-surface">
        {list.map((p) => (
          <Row key={p.id} p={p} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl">Payouts</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The app never moves money — it tracks who is owed until you mark
          them paid.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-halftime/50 bg-halftime/10 px-4 py-3">
          <p className="text-2xs tracking-widest text-muted-foreground uppercase">
            Owed
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums" data-numeric>
            {fmtUsd(owedTotal)}
          </p>
          <p className="mt-0.5 text-2xs text-muted-foreground" data-numeric>
            {owed.length} payout{owed.length === 1 ? "" : "s"} open
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-2xs tracking-widest text-muted-foreground uppercase">
            Paid
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums" data-numeric>
            {fmtUsd(paidTotal)}
          </p>
          <p className="mt-0.5 text-2xs text-muted-foreground" data-numeric>
            {paid.length} settled
          </p>
        </div>
      </div>

      {payouts.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
          No payouts yet. They appear here the moment a game is scored.
        </div>
      ) : (
        <div className="space-y-4">
          {owed.length > 0 && <Group title="Owed" list={owed} />}
          {paid.length > 0 && <Group title="Paid" list={paid} />}
          {voided.length > 0 && <Group title="Void" list={voided} />}
        </div>
      )}

      {/* Mark paid */}
      <Dialog
        open={settling !== null}
        onOpenChange={(o) => !o && setSettling(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark paid</DialogTitle>
            <DialogDescription data-numeric>
              {settling
                ? `${settling.display_name ?? "Unclaimed"} — ${fmtUsd(settling.amount_cents)} (block ${settling.block_number})`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="paid-on">Date</Label>
              <Input
                id="paid-on"
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paid-method">Method</Label>
              <select
                id="paid-method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
              >
                <option value="venmo">Venmo</option>
                <option value="cash">Cash</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSettling(null)}>
              Cancel
            </Button>
            <Button disabled={pending || !paidOn} onClick={submitSettle}>
              {pending ? "Saving…" : "Mark paid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Winner message */}
      <Dialog
        open={messageFor !== null}
        onOpenChange={(o) => !o && setMessageFor(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Winner message</DialogTitle>
            <DialogDescription>
              Plain text for the group chat.
            </DialogDescription>
          </DialogHeader>
          {message ? (
            <pre className="overflow-x-auto rounded-lg bg-surface-2 p-4 font-mono text-sm whitespace-pre-wrap">
              {message}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              Game not found for this payout.
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMessageFor(null)}>
              Close
            </Button>
            <Button disabled={!message} onClick={() => message && copy(message)}>
              <Copy data-icon="inline-start" />
              Copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
