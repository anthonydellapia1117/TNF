import type { Metadata } from "next";
import { Suspense } from "react";
import { BoardGrid } from "@/components/board/board-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { getConfig, getPot, getPublicBlocks } from "@/lib/data/public";
import { committedBlocks } from "@/lib/pool";
import { isSeasonMode } from "@/lib/season-mode";

// The description is the line under the URL in a group chat, so it stops
// advertising what's open once the season is running. Placement words only:
// open and taken. Paid versus unpaid is the admin's tracker, never this page's.
export async function generateMetadata(): Promise<Metadata> {
  const config = await getConfig();
  return {
    title: "Blocks",
    description: isSeasonMode(config)
      ? "The 100-block board - who has what."
      : "The 100-block board - what's open, what's taken, and who has what.",
  };
}

export const revalidate = 30;

export default async function BlocksPage() {
  const [blocks, config, pot] = await Promise.all([
    getPublicBlocks(),
    getConfig(),
    getPot(),
  ]);

  // Committed blocks include requests with no number chosen yet, so the
  // availability counter never oversells (due_cents counts them at read time).
  const committed = committedBlocks(pot);
  const open = Math.max(0, config.blocks_total - committed);
  const unnumbered = Math.max(0, pot.available - open);

  return (
    <div className="space-y-5">
      {/* The availability counter. This page exists to show what is open,
          so the count stays in both modes - unlike the home page, where the
          same number was reading as a pool that did not fill.

          Nothing about collecting here, in either mode: no price, no
          deadline, no call to action. Those live on /admin only (CLAUDE.md,
          Public surfaces). */}
      <section className="rounded-lg border border-border bg-surface px-4 py-6 text-center sm:py-8">
        <p className="flex items-baseline justify-center gap-2 text-pool-accent">
          <span className="text-3xl font-semibold" data-numeric>
            {open}
          </span>
          <span className="text-xl font-semibold tracking-widest">
            AVAILABLE
          </span>
        </p>
        {open === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Every block is taken - see you Thursday nights.
          </p>
        )}
        {unnumbered > 0 && (
          <p className="mt-1 text-2xs text-muted-foreground" data-numeric>
            {unnumbered} of the open numbers below are spoken for by players
            still picking their spots.
          </p>
        )}
      </section>

      {/* Suspense: the board reads its ?show= filter from the URL. */}
      <Suspense fallback={<Skeleton className="mx-auto aspect-square w-full max-w-3xl" />}>
        <BoardGrid blocks={blocks} />
      </Suspense>
    </div>
  );
}
