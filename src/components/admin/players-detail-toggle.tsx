"use client";

// The public /players detail switch: FULL shows method, status, and group;
// LEAN is #, player, block only. Stored in config — flipping it changes the
// public page immediately, no deploy.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setPlayersDetail } from "@/app/admin/actions";

const MODES = [
  { value: "full", label: "Full", hint: "player · group · block · method" },
  { value: "lean", label: "Lean", hint: "player · block only" },
] as const;

export function PlayersDetailToggle({
  current,
}: {
  current: "full" | "lean";
}) {
  const router = useRouter();
  const [mode, setMode] = useState(current);
  const [pending, startTransition] = useTransition();

  const flip = (next: "full" | "lean") => {
    if (next === mode || pending) return;
    startTransition(async () => {
      const res = await setPlayersDetail(next);
      if (res.ok) {
        setMode(next);
        toast.success(
          `Public players page is now ${next.toUpperCase()} — live immediately.`,
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
        <p className="text-sm font-medium">Public players detail</p>
        <p className="truncate text-2xs text-muted-foreground">
          {MODES.find((m) => m.value === mode)?.hint}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Public players detail level"
        className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface-2/50 p-0.5"
      >
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={mode === m.value}
            disabled={pending}
            onClick={() => flip(m.value)}
            className={cn(
              "h-8 rounded-md px-3 text-xs font-semibold tracking-wide uppercase transition-colors duration-150",
              mode === m.value
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
