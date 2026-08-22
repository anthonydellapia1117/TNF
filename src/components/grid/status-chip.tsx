import { cn } from "@/lib/utils";
import type { PublicGame } from "@/lib/types";

type ChipState = {
  label: string;
  className: string;
  pulse?: boolean;
};

export function gameChip(game: PublicGame): ChipState {
  if (game.status === "void")
    return { label: "VOID", className: "border-border text-muted-foreground" };
  if (game.status === "final")
    return { label: "FINAL", className: "border-final/50 bg-final/15 text-final" };
  if (game.status === "halftime")
    return { label: "HALFTIME", className: "border-live/50 bg-live/15 text-live" };
  if (game.status === "in_progress")
    return {
      label: "LIVE",
      className: "border-live/60 bg-live/15 text-live",
      pulse: true,
    };
  if (game.digits_published_at)
    return {
      label: "DIGITS PUBLISHED",
      className: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400",
    };
  if (game.digits_assigned)
    return {
      label: "DIGITS ASSIGNED",
      className: "border-halftime/50 bg-halftime/10 text-halftime",
    };
  if (!game.date_confirmed)
    return {
      label: "DATE TBD",
      className: "border-halftime/50 bg-halftime/10 text-halftime",
    };
  return {
    label: "DIGITS NOT ASSIGNED",
    className: "border-halftime/50 bg-halftime/10 text-halftime",
  };
}

export function StatusChip({ game }: { game: PublicGame }) {
  const chip = gameChip(game);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-semibold tracking-wide whitespace-nowrap",
        chip.className,
      )}
    >
      {chip.pulse && (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-live" />
        </span>
      )}
      {chip.label}
    </span>
  );
}
