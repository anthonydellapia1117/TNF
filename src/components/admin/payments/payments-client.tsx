"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtDateOnly, fmtUsd } from "@/lib/format";
import type { Payment } from "@/lib/types";
import type { ParticipantWithFinance } from "@/lib/data/admin";
import { recordPayment } from "@/app/admin/actions";
import {
  compareValues,
  useTableSort,
  type TableSort,
} from "@/components/admin/use-table-sort";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type Method = Payment["method"];

const METHODS: { value: Method; label: string }[] = [
  { value: "venmo", label: "Venmo" },
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "comp", label: "Comp" },
  { value: "correction", label: "Correction" },
];

/** Sentinel — Radix Select items cannot carry an empty value. */
const UNMATCHED = "__unmatched__";

const LEDGER_SORT_KEYS = [
  "date",
  "participant",
  "amount",
  "method",
  "txn",
  "note",
] as const;
type LedgerSortKey = (typeof LEDGER_SORT_KEYS)[number];

/** Local YYYY-MM-DD, computed on the phone so "today" is Anthony's today. */
function todayLocalYMD(): string {
  return new Date().toLocaleDateString("en-CA");
}

function balanceClass(due: number, paid: number): string {
  const bal = due - paid;
  if (bal <= 0) return due > 0 || paid > 0 ? "text-emerald-400" : "text-muted-foreground";
  if (paid === 0) return "text-destructive";
  return "text-halftime";
}

export function PaymentsClient({
  payments,
  participants,
}: {
  payments: Payment[];
  participants: ParticipantWithFinance[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Record-payment form
  const [participantSel, setParticipantSel] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("venmo");
  const [paidOn, setPaidOn] = useState("");
  const [venmoTxnId, setVenmoTxnId] = useState("");
  const [note, setNote] = useState("");
  const [corrects, setCorrects] = useState("");

  // Default date to today after mount — a server-rendered default could be a
  // different calendar day than the phone's.
  useEffect(() => {
    setPaidOn((d) => d || todayLocalYMD());
  }, []);

  const nameById = useMemo(
    () =>
      new Map(participants.map((p) => [p.id, p.display_alias || p.full_name])),
    [participants],
  );
  const paymentName = useCallback(
    (p: Payment) =>
      p.participant_id
        ? (nameById.get(p.participant_id) ?? "Unknown")
        : "Unmatched",
    [nameById],
  );

  // F1: search filters the ledger, then the active sort orders what's left.
  const [query, setQuery] = useState("");
  const [sort, toggleSort] = useTableSort<LedgerSortKey>(LEDGER_SORT_KEYS, {
    key: "date",
    dir: "desc",
  });

  const ledger = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? payments.filter((p) =>
          [paymentName(p), p.method, p.venmo_txn_id ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : payments;
    const value = (p: Payment): unknown => {
      switch (sort.key) {
        case "date":
          return p.paid_on;
        case "participant":
          return paymentName(p);
        case "amount":
          return p.amount_cents;
        case "method":
          return p.method;
        case "txn":
          return p.venmo_txn_id;
        case "note":
          return p.note;
      }
    };
    return [...filtered].sort((a, b) => {
      const cmp = compareValues(value(a), value(b));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [payments, query, sort, paymentName]);

  const options = useMemo(
    () =>
      [...participants]
        .sort((a, b) =>
          (a.display_alias || a.full_name).localeCompare(
            b.display_alias || b.full_name,
          ),
        )
        .map((p) => ({
          id: p.id,
          label: p.display_alias
            ? `${p.display_alias} (${p.full_name})`
            : p.full_name,
        })),
    [participants],
  );

  // Computed balance beside the raw ledger — drift is impossible to hide.
  const ledgerSum = payments.reduce((s, p) => s + p.amount_cents, 0);
  const matchedSum = payments
    .filter((p) => p.participant_id !== null)
    .reduce((s, p) => s + p.amount_cents, 0);
  const unmatchedCount = payments.length - payments.filter((p) => p.participant_id !== null).length;
  const totalDue = participants.reduce(
    (s, p) => s + p.finance.amount_due_cents,
    0,
  );
  const totalPaid = participants.reduce(
    (s, p) => s + p.finance.amount_paid_cents,
    0,
  );
  const outstanding = totalDue - totalPaid;
  const drift = matchedSum !== totalPaid;

  const withMoney = useMemo(
    () =>
      participants
        .filter(
          (p) =>
            p.finance.amount_due_cents !== 0 ||
            p.finance.amount_paid_cents !== 0,
        )
        .sort((a, b) =>
          (a.display_alias || a.full_name).localeCompare(
            b.display_alias || b.full_name,
          ),
        ),
    [participants],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!participantSel) {
      toast.error("Pick a participant — or Unmatched.");
      return;
    }
    const dollars = parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars === 0) {
      toast.error("Enter a non-zero amount.");
      return;
    }
    if (!paidOn) {
      toast.error("Date is required.");
      return;
    }
    startTransition(async () => {
      const result = await recordPayment({
        participantId: participantSel === UNMATCHED ? null : participantSel,
        amountCents: Math.round(dollars * 100),
        method,
        paidOn,
        venmoTxnId: method === "venmo" ? venmoTxnId.trim() : "",
        sourceRef: "",
        note: note.trim(),
        correctsPaymentId: method === "correction" && corrects ? corrects : null,
      });
      if (result.ok) {
        toast.success("Recorded — promotion runs automatically on full payment.");
        setAmount("");
        setVenmoTxnId("");
        setNote("");
        setCorrects("");
        router.refresh();
      } else {
        toast.error(result.error ?? "Record failed.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl">Payments</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Append-only ledger. Corrections are new rows — nothing is ever edited
          or deleted.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        {/* Record payment */}
        <form
          onSubmit={submit}
          className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <h2 className="col-span-2 text-sm font-semibold">Record payment</h2>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="pay-participant">Participant</Label>
            <Select value={participantSel} onValueChange={setParticipantSel}>
              <SelectTrigger
                id="pay-participant"
                className="h-12 w-full sm:h-8"
              >
                <SelectValue placeholder="Who paid?" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNMATCHED}>Unmatched</SelectItem>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount ($)</Label>
            <Input
              id="pay-amount"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="150 or -150"
              autoComplete="off"
              className="h-12 sm:h-8"
              data-numeric
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pay-method">Method</Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as Method)}
            >
              <SelectTrigger id="pay-method" className="h-12 w-full sm:h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pay-date">Date</Label>
            <Input
              id="pay-date"
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
              className="h-12 sm:h-8"
              data-numeric
            />
          </div>

          {method === "venmo" && (
            <div className="space-y-1.5">
              <Label htmlFor="pay-venmo">Venmo txn id</Label>
              <Input
                id="pay-venmo"
                value={venmoTxnId}
                onChange={(e) => setVenmoTxnId(e.target.value)}
                placeholder="Dedupes on this"
                autoComplete="off"
                className="h-12 font-mono sm:h-8"
              />
            </div>
          )}

          {method === "correction" && (
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="pay-corrects">Corrects payment</Label>
              <Select value={corrects} onValueChange={setCorrects}>
                <SelectTrigger id="pay-corrects" className="h-12 w-full sm:h-8">
                  <SelectValue placeholder="Which row is wrong?" />
                </SelectTrigger>
                <SelectContent>
                  {payments.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {fmtDateOnly(p.paid_on)} · {fmtUsd(p.amount_cents)} ·{" "}
                      {paymentName(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="pay-note">Note</Label>
            <Input
              id="pay-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
              autoComplete="off"
              className="h-12 sm:h-8"
            />
          </div>

          <Button
            type="submit"
            disabled={pending}
            className="col-span-2 h-12 sm:h-9"
          >
            {pending ? "Recording…" : "Record payment"}
          </Button>
        </form>

        <div className="space-y-4">
          {/* Computed totals beside the ledger */}
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Ledger sum"
              value={fmtUsd(ledgerSum)}
              sub={`${payments.length} row${payments.length === 1 ? "" : "s"}${unmatchedCount > 0 ? ` · ${unmatchedCount} unmatched` : ""} · finance ${fmtUsd(totalPaid)}`}
              alert={drift}
            />
            <Stat label="Total due" value={fmtUsd(totalDue)} sub="Committed blocks" />
            <Stat
              label="Outstanding"
              value={fmtUsd(outstanding)}
              sub="Due minus paid"
              alert={outstanding > 0}
            />
          </div>

          {/* The raw ledger, newest first */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Ledger</h2>
              <p className="text-2xs text-muted-foreground">
                Append-only. Corrections are new rows.
              </p>
            </div>

            {payments.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
                No payments yet. Record the first one on the left.
              </div>
            ) : (
              <>
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, method, txn…"
                  autoComplete="off"
                  aria-label="Search ledger"
                  className="h-12 sm:h-8"
                />

                {ledger.length === 0 ? (
                  <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
                    No payments match &ldquo;{query}&rdquo;.
                  </div>
                ) : (
                  <>
                  {/* Mobile: stacked cards */}
                  <div className="space-y-2 md:hidden">
                    {ledger.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-lg border border-border bg-surface p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-medium">
                            {paymentName(p)}
                          </p>
                          <p
                            className={cn(
                              "shrink-0 text-sm font-medium",
                              p.amount_cents < 0 && "text-destructive",
                            )}
                            data-numeric
                          >
                            {fmtUsd(p.amount_cents)}
                          </p>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span data-numeric>{fmtDateOnly(p.paid_on)}</span>
                          <Badge variant="outline">{p.method}</Badge>
                          {p.venmo_txn_id && (
                            <span className="max-w-32 truncate font-mono text-2xs">
                              {p.venmo_txn_id}
                            </span>
                          )}
                        </div>
                        {p.note && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {p.note}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Desktop: dense table */}
                  <div className="hidden rounded-lg border border-border bg-surface md:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>
                            <SortHead label="Date" k="date" sort={sort} onSort={toggleSort} />
                          </TableHead>
                          <TableHead>
                            <SortHead label="Participant" k="participant" sort={sort} onSort={toggleSort} />
                          </TableHead>
                          <TableHead className="text-right">
                            <SortHead label="Amount" k="amount" sort={sort} onSort={toggleSort} />
                          </TableHead>
                          <TableHead>
                            <SortHead label="Method" k="method" sort={sort} onSort={toggleSort} />
                          </TableHead>
                          <TableHead>
                            <SortHead label="Venmo txn" k="txn" sort={sort} onSort={toggleSort} />
                          </TableHead>
                          <TableHead>
                            <SortHead label="Note" k="note" sort={sort} onSort={toggleSort} />
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ledger.map((p) => (
                          <TableRow key={p.id} className="h-10">
                            <TableCell className="whitespace-nowrap">
                              {fmtDateOnly(p.paid_on)}
                            </TableCell>
                            <TableCell className="max-w-44 truncate font-medium">
                              {paymentName(p)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right",
                                p.amount_cents < 0 && "text-destructive",
                              )}
                            >
                              {fmtUsd(p.amount_cents)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{p.method}</Badge>
                            </TableCell>
                            <TableCell className="max-w-28 truncate font-mono text-xs text-muted-foreground">
                              {p.venmo_txn_id ?? "—"}
                            </TableCell>
                            <TableCell className="max-w-48 truncate text-muted-foreground">
                              {p.note ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* Per-participant balances */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Per participant</h2>
            {withMoney.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
                Nobody owes anything yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-surface">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Alias</TableHead>
                      <TableHead className="text-right">Due</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {withMoney.map((p) => (
                      <TableRow key={p.id} className="h-10">
                        <TableCell className="max-w-40 truncate font-medium">
                          {p.display_alias || p.full_name}
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
                            balanceClass(
                              p.finance.amount_due_cents,
                              p.finance.amount_paid_cents,
                            ),
                          )}
                        >
                          {fmtUsd(
                            p.finance.amount_due_cents -
                              p.finance.amount_paid_cents,
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** F1 column-header sort button: label + ▲/▼ on the active column. */
function SortHead<K extends string>({
  label,
  k,
  sort,
  onSort,
}: {
  label: string;
  k: K;
  sort: TableSort<K>;
  onSort: (key: K) => void;
}) {
  const active = sort.key === k;
  const Chevron = sort.dir === "desc" ? ChevronDown : ChevronUp;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={cn(
        "inline-flex items-center gap-0.5 transition-colors hover:text-foreground",
        active && "text-foreground",
      )}
    >
      {label}
      {active && <Chevron className="size-3" />}
    </button>
  );
}

function Stat({
  label,
  value,
  sub,
  alert = false,
}: {
  label: string;
  value: string;
  sub: string;
  alert?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <p className="text-2xs tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold sm:text-xl" data-numeric>
        {value}
      </p>
      <p
        className={cn(
          "mt-0.5 text-2xs",
          alert ? "text-halftime" : "text-muted-foreground",
        )}
        data-numeric
      >
        {sub}
      </p>
    </div>
  );
}
