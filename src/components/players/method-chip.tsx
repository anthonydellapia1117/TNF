// The public method vocabulary is exactly two words: REQUESTED (green) for
// a number somebody specifically asked for this year, RANDOMIZED (orange)
// for everything the pool assigned. No "random", no lowercase, no
// combining with status. Admin screens keep their own richer labels.

import { cn } from "@/lib/utils";

export function methodLabel(method: string | null): "REQUESTED" | "RANDOMIZED" {
  return method === "requested" ? "REQUESTED" : "RANDOMIZED";
}

export function MethodChip({
  method,
  className,
}: {
  method: string | null;
  className?: string;
}) {
  const requested = method === "requested";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-semibold tracking-wide whitespace-nowrap",
        requested
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
          : "border-orange-500/50 bg-orange-500/10 text-orange-400",
        className,
      )}
    >
      {methodLabel(method)}
    </span>
  );
}
