import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BlockSeason } from "@/components/block/block-season";
import {
  getConfig,
  getPublicBlocks,
  getPublicGames,
  getPublicPayouts,
} from "@/lib/data/public";
import { fmtDateET, fmtUsd } from "@/lib/format";
import { blockPosition } from "@/lib/pool";
import { cn } from "@/lib/utils";
import type { BlockStatus } from "@/lib/types";

export const revalidate = 30;

/** "/block/7" → 7. Anything that isn't an integer 1..100 is a 404. */
function parseBlockNumber(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 100 ? n : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ n: string }>;
}): Promise<Metadata> {
  const { n: raw } = await params;
  const n = parseBlockNumber(raw);
  if (n === null) return { title: "Block not found" };
  return {
    title: `Block ${n}`,
    description: `Block ${n} across the whole season — digits, hits, and winnings.`,
  };
}

/** Badge styling mirrors the board legend: dashed open, amber reserved, solid taken. */
const STATUS_BADGE: Record<BlockStatus, { label: string; className: string }> = {
  available: {
    label: "OPEN",
    className:
      "border-dashed border-pool-accent/60 bg-pool-accent/10 text-pool-accent",
  },
  reserved: {
    label: "RESERVED",
    className: "border-halftime/50 bg-halftime/10 text-halftime",
  },
  assigned: {
    label: "TAKEN",
    className: "border-border bg-surface-2 text-foreground",
  },
  held: {
    label: "HELD",
    className: "border-border/60 bg-surface-2/40 text-muted-foreground",
  },
};

export default async function BlockPage({
  params,
}: {
  params: Promise<{ n: string }>;
}) {
  const { n: raw } = await params;
  const n = parseBlockNumber(raw);
  if (n === null) notFound();

  const [games, blocks, payouts, config] = await Promise.all([
    getPublicGames(),
    getPublicBlocks(),
    getPublicPayouts(),
    getConfig(),
  ]);

  const block = blocks.find((b) => b.block_number === n);
  const status: BlockStatus = block?.status ?? "available";
  const badge = STATUS_BADGE[status];
  const { row, col } = blockPosition(n);

  const wins = payouts.filter((p) => p.block_number === n);
  const totalCents = wins.reduce((sum, p) => sum + p.amount_cents, 0);
  const seasonUnderway = games.some(
    (g) =>
      g.status === "in_progress" ||
      g.status === "halftime" ||
      g.status === "final",
  );
  const firstKickoff =
    games.find((g) => g.kickoff_at !== null)?.kickoff_at ?? null;
  // The pool is 23 games by spec; fall back to that before the schedule lands.
  const gameCount = games.length > 0 ? games.length : 23;

  return (
    <div className="space-y-5">
      {/* Who has it, and where it sits on the grid. */}
      <header className="rounded-lg border border-border bg-surface px-4 py-5 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-2xs font-semibold tracking-widest text-muted-foreground uppercase">
              Block
            </p>
            <p className="flex items-baseline gap-1.5">
              <span
                className="text-3xl leading-none font-semibold sm:text-4xl"
                data-numeric
              >
                {n}
              </span>
              <span className="text-sm text-muted-foreground" data-numeric>
                of 100
              </span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 text-right">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-semibold tracking-wide whitespace-nowrap",
                badge.className,
              )}
            >
              {badge.label}
            </span>
            {block?.display_name && (
              <p className="max-w-48 truncate text-sm font-medium sm:max-w-xs">
                {block.display_name}
              </p>
            )}
            <p className="text-2xs text-muted-foreground" data-numeric>
              Row {row + 1} · Col {col + 1}
            </p>
          </div>
        </div>
      </header>

      {/* The sales nudge — only while the block is still open. */}
      {status === "available" && (
        <section className="rounded-lg border border-dashed border-pool-accent/60 bg-pool-accent/[0.04] px-4 py-4 text-center">
          <p className="text-sm font-medium">
            This block is open.{" "}
            <span className="font-normal text-muted-foreground" data-numeric>
              {fmtUsd(config.price_per_block_cents)}, fixed payouts, {gameCount}{" "}
              games.
            </span>
          </p>
          <Link
            href="/blocks"
            className="mt-1.5 inline-block text-xs font-medium text-pool-accent transition-colors duration-150 hover:text-foreground"
          >
            See the full board →
          </Link>
        </section>
      )}

      {/* Running total — the number a player checks all season. */}
      <section className="rounded-lg border border-border bg-surface px-4 py-6 text-center sm:py-8">
        <p
          className="text-3xl font-semibold text-final sm:text-4xl"
          data-numeric
        >
          {fmtUsd(totalCents)}
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {totalCents > 0 ? (
            <>
              won so far · <span data-numeric>{wins.length}</span>{" "}
              {wins.length === 1 ? "hit" : "hits"}
            </>
          ) : seasonUnderway ? (
            "won so far — no hits yet"
          ) : (
            <>
              won so far — season starts{" "}
              <span data-numeric>{fmtDateET(firstKickoff)}</span>
            </>
          )}
        </p>
      </section>

      <BlockSeason games={games} n={n} config={config} />
    </div>
  );
}
