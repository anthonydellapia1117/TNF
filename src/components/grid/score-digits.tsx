import { cn } from "@/lib/utils";

/**
 * A score with the last digit at full opacity and the leading digits at 60%.
 * The last digit is the only part that matters, and showing that teaches
 * the game (spec 4.1).
 */
export function ScoreDigits({
  score,
  className,
  style,
}: {
  score: number | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (score === null || score === undefined) {
    return (
      <span
        className={cn("font-semibold text-muted-foreground tabular-nums", className)}
        data-numeric
      >
        -
      </span>
    );
  }
  const s = String(score);
  const head = s.slice(0, -1);
  const last = s.slice(-1);
  return (
    <span
      className={cn("font-semibold tabular-nums", className)}
      style={style}
      data-numeric
    >
      {head && <span className="opacity-60">{head}</span>}
      <span>{last}</span>
    </span>
  );
}
