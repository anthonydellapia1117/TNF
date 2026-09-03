"use client";

// The season-mode switch. OFF is the sales page: open counts, the claim
// CTA, the claim-by countdown, collected money. ON is a season in
// progress: next game, the grid, recent winners — and nothing that reads
// as a pool that did not fill. Stored in config, so flipping it changes
// every public surface immediately with no deploy.
//
// It also changes what v_pot hands an anonymous caller, so this is a real
// gate and not a CSS trick.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Megaphone, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { setSeasonMode } from "@/app/admin/actions";

const MODES = [
  {
    value: false,
    label: "Selling",
    hint: "public shows open blocks, the claim CTA, and the deadline",
  },
  {
    value: true,
    label: "Season",
    hint: "public leads with the next game, the grid, and winners",
  },
] as const;

export function SeasonModeToggle({ current }: { current: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(current);
  const [pending, startTransition] = useTransition();

  const flip = (next: boolean) => {
    if (next === on || pending) return;
    startTransition(async () => {
      const res = await setSeasonMode(next);
      if (res.ok) {
        setOn(next);
        toast.success(
          next
            ? "Season mode ON — the public side no longer shows open blocks or the claim CTA. Live immediately."
            : "Season mode OFF — the public side is selling again: open count, claim CTA, deadline.",
        );
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {on ? (
            <Trophy className="size-3.5 text-emerald-400" aria-hidden />
          ) : (
            <Megaphone className="size-3.5 text-pool-accent" aria-hidden />
          )}
          Public side
        </p>
        <p className="truncate text-2xs text-muted-foreground">
          {MODES.find((m) => m.value === on)?.hint}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Public side mode"
        className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface-2/50 p-0.5"
      >
        {MODES.map((m) => (
          <button
            key={String(m.value)}
            type="button"
            role="radio"
            aria-checked={on === m.value}
            disabled={pending}
            onClick={() => flip(m.value)}
            className={cn(
              "h-8 rounded-md px-3 text-xs font-semibold tracking-wide uppercase transition-colors duration-150",
              on === m.value
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
