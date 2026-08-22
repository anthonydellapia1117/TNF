import type { Metadata } from "next";
import { BoardGrid } from "@/components/board/board-grid";
import { getConfig, getPot, getPublicBlocks } from "@/lib/data/public";
import { fmtDateOnly, fmtUsd } from "@/lib/format";

export const metadata: Metadata = {
  title: "Blocks",
  description:
    "The 100-block board — what's open, what's claimed, and who has what.",
};

export const revalidate = 30;

export default async function BlocksPage() {
  const [blocks, config, pot] = await Promise.all([
    getPublicBlocks(),
    getConfig(),
    getPot(),
  ]);

  // Committed blocks include requests with no number chosen yet, so the
  // sales counter never oversells (due_cents counts them at read time).
  const committed =
    config.price_per_block_cents > 0
      ? Math.round(pot.due_cents / config.price_per_block_cents)
      : 0;
  const open = Math.max(0, config.blocks_total - committed);
  const unnumbered = Math.max(0, pot.available - open);

  return (
    <div className="space-y-5">
      {/* The sales counter — the line Anthony screenshots into the chat. */}
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

      <BoardGrid blocks={blocks} config={config} />
    </div>
  );
}
