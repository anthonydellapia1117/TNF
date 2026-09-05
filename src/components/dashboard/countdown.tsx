"use client";

import { useEffect, useState } from "react";

// Ticking kickoff countdown. Server-renders real values (so first paint is
// correct), then ticks every second after hydration - the value text carries
// suppressHydrationWarning because server and client clocks differ.

interface Segment {
  value: string;
  label: string;
}

function segments(msLeft: number): Segment[] {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    { value: String(days), label: "days" },
    { value: pad(hours), label: "hrs" },
    { value: pad(minutes), label: "min" },
    { value: pad(seconds), label: "sec" },
  ];
}

export function Countdown({ kickoffAt }: { kickoffAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!kickoffAt) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [kickoffAt]);

  if (!kickoffAt) return null;

  const target = new Date(kickoffAt).getTime();
  if (Number.isNaN(target)) return null;

  return (
    <div
      className="flex items-center justify-center gap-2 sm:gap-3"
      role="timer"
      aria-label="Time until kickoff"
    >
      {segments(target - now).map((s) => (
        <div
          key={s.label}
          className="w-16 rounded-md border border-border bg-surface-2 py-2 sm:w-20 sm:py-2.5"
        >
          <div
            className="text-xl font-semibold tabular-nums sm:text-2xl"
            data-numeric
            suppressHydrationWarning
          >
            {s.value}
          </div>
          <div className="text-2xs tracking-widest text-muted-foreground uppercase">
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}
