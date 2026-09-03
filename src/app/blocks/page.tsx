import type { Metadata } from "next";
import { Suspense } from "react";
import { BoardGrid } from "@/components/board/board-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { getConfig, getPot, getPublicBlocks } from "@/lib/data/public";
import { fmtDateOnly, fmtUsd } from "@/lib/format";
import { committedBlocks } from "@/lib/pool";
import { isSeasonMode } from "@/lib/season-mode";

// The description is the line under the URL in a group chat, so it stops
// advertising what's open once the season is running.
export async function generateMetadata(): Promise<Metadata> {
  const config = await getConfig();
  return {
    title: "Blocks",
    description: isSeasonMode(config)
      ? "The 100-block board — who has what."
      : "The 100-block board — what's open, what's claimed, and who has what.",
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
  // sales counter never oversells (due_cents counts them at read time).
  const committed = committedBlocks(pot);
  const open = Math.max(0, config.blocks_total - committed);
  const unnumbered = Math.max(0, pot.available - open);

  return (
    <div className="space-y-5">
      {/* The sales counter — the line Anthony screenshots into the chat
          while he is still selling. In season mode "51 AVAILABLE" reads as
          a pool that did not fill, so the whole panel goes. */}
      {!isSeasonMode(config) && (
      <section className="rounded-lg border border-border bg-surface px-4 py-6 text-center sm:py-8">
        <p className="flex items-baseline justify-center gap-2 text-pool-accent">
          <span className="text-3xl font-semibold" data-numeric>
            {open}
          </span>
          <span className="text-xl font-semibold tracking-widest">
            AVAILABLE
          </span>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {open > 0 ? (
            <>
              <span data-numeric>{fmtUsd(config.price_per_block_cents)}</span>{" "}
              each · claim by{" "}
              <span data-numeric>{fmtDateOnly(config.claim_deadline)}</span>
            </>
          ) : (
            "Every block is claimed — see you Thursday nights."
          )}
        </p>
        {unnumbered > 0 && (
          <p className="mt-1 text-2xs text-muted-foreground" data-numeric>
            {unnumbered} of the unclaimed numbers below are spoken for by
            players still picking their spots.
          </p>
        )}
      </section>
      )}

      {/* Without the counter the page would open straight onto the board,
          so season mode gets a plain title instead of a sales panel. */}
      {isSeasonMode(config) && (
        <section className="text-center">
          <h1 className="text-lg font-semibold">The board</h1>
          <p className="mt-0.5 text-sm text-muted-foreground" data-numeric>
            All {config.blocks_total} blocks — tap any number for its season.
          </p>
        </section>
      )}

      {/* Suspense: the board reads its ?show= filter from the URL. */}
      <Suspense fallback={<Skeleton className="mx-auto aspect-square w-full max-w-3xl" />}>
        <BoardGrid blocks={blocks} config={config} />
      </Suspense>
    </div>
  );
}
