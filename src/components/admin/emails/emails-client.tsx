"use client";

// F5: the distribution list. One tap to copy every visible address into a
// BCC field — filtered to paid, unpaid, or missing-email as needed. A
// missing email is a legitimate state (spec H4: text/in-person signups),
// so it renders amber-informational, never as an error.

import { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ParticipantFinance } from "@/lib/types";
import type { ParticipantWithFinance } from "@/lib/data/admin";
import { compareValues } from "@/components/admin/use-table-sort";
import { Button } from "@/components/ui/button";

const FILTERS = ["all", "paid", "unpaid", "missing"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  all: "ALL",
  paid: "PAID",
  unpaid: "UNPAID",
  missing: "MISSING EMAIL",
};

function emailOf(p: ParticipantWithFinance): string | null {
  const e = p.email?.trim();
  return e ? e : null;
}

function isPaid(f: ParticipantFinance): boolean {
  return f.amount_paid_cents >= f.amount_due_cents && f.amount_due_cents > 0;
}

function matches(p: ParticipantWithFinance, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "paid":
      return isPaid(p.finance);
    case "unpaid":
      return p.finance.amount_due_cents > 0 && !isPaid(p.finance);
    case "missing":
      return emailOf(p) === null;
  }
}

export function EmailsClient({
  participants,
}: {
  participants: ParticipantWithFinance[];
}) {
  // Filter lives in the URL (?f=) but applies after mount so server and
  // client HTML match on first paint — same pattern as use-table-sort.
  const [filter, setFilterState] = useState<Filter>("all");

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("f");
    if (raw && (FILTERS as readonly string[]).includes(raw)) {
      setFilterState(raw as Filter);
    }
  }, []);

  const setFilter = (f: Filter) => {
    setFilterState(f);
    try {
      const url = new URL(window.location.href);
      if (f === "all") url.searchParams.delete("f");
      else url.searchParams.set("f", f);
      window.history.replaceState(null, "", url);
    } catch {
      /* URL persistence is best effort */
    }
  };

  const sorted = useMemo(
    () =>
      [...participants].sort((a, b) =>
        compareValues(
          a.display_alias ?? a.full_name,
          b.display_alias ?? b.full_name,
        ),
      ),
    [participants],
  );

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, paid: 0, unpaid: 0, missing: 0 };
    for (const f of FILTERS) c[f] = sorted.filter((p) => matches(p, f)).length;
    return c;
  }, [sorted]);

  const visible = useMemo(
    () => sorted.filter((p) => matches(p, filter)),
    [sorted, filter],
  );
  const addresses = useMemo(
    () =>
      visible
        .map(emailOf)
        .filter((e): e is string => e !== null),
    [visible],
  );
  const joined = addresses.join(", ");

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(joined);
      toast.success(
        `${addresses.length} address${addresses.length === 1 ? "" : "es"} copied — paste into BCC`,
      );
    } catch {
      toast.error("Copy failed — long-press the preview and copy manually.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl">Emails</h1>
          <p className="mt-0.5 text-sm text-muted-foreground" data-numeric>
            {addresses.length} of {visible.length} have email
          </p>
        </div>
        <Button
          onClick={() => void copyAll()}
          disabled={addresses.length === 0}
          className="h-12 shrink-0 sm:h-8"
        >
          <Copy data-icon="inline-start" />
          Copy all
        </Button>
      </div>

      {/* Segmented filter */}
      <div
        role="radiogroup"
        aria-label="Filter distribution list"
        className="flex items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-surface p-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold tracking-wide whitespace-nowrap transition-colors duration-150",
              filter === f
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {FILTER_LABEL[f]}
            <span className="tabular-nums opacity-70" data-numeric>
              {counts[f]}
            </span>
          </button>
        ))}
      </div>

      {/* BCC preview */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2">
        <p className="font-mono text-xs whitespace-nowrap text-muted-foreground">
          {joined || "No addresses in this view."}
        </p>
      </div>

      {/* The list */}
      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
          {participants.length === 0
            ? "No participants yet."
            : "Nobody matches this filter."}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          {visible.map((p) => {
            const email = emailOf(p);
            return (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
              >
                <span className="min-w-0 truncate text-sm font-medium">
                  {p.display_alias ?? p.full_name}
                </span>
                {email ? (
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {email}
                  </span>
                ) : (
                  <span className="shrink-0 rounded-md border border-halftime/50 bg-halftime/10 px-1.5 py-0.5 text-2xs text-halftime">
                    no email — text/in-person signup
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
