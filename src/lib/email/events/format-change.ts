// The format email (Anthony, 2026-11-10, Parts J and L). Event key:
// format_change_YYYY-MM-DD. A broadcast with its own envelope, which Anthony
// set for this send: To Anthony alone, Cc every other owner with an address,
// Bcc every holder address (admin_email_broadcast_plan, migration 41).
//
// The words are Anthony's, approved at 12:38 PM ET on 2026-11-10. Every number
// that the app holds comes from the database (config and the slate): the
// price, two blocks for the old price, the two payouts, the game count, the
// block total and the payment deadline. Three things are not app state and are
// fixed here: the 50 entries the pool had before every holder doubled, the
// old 500 price, and Sunday Nov 15, the date Anthony gave for replies asking
// for fewer blocks. Names no holder and nothing anyone owes.

import type { EmailContext, EmailSpec } from "../types.ts";
import { amount, civil } from "../format.ts";
import { claimDeadline, seasonYear, uniformPayouts } from "../facts.ts";
import { POOL_SUBJECT, SIGNOFF, SITE } from "../copy.ts";

export const FORMAT_CHANGE_KEY = /^format_change_(\d{4}-\d{2}-\d{2})$/;

/** Entries before every holder doubled (Part J checkpoint 1: 50 held blocks). */
export const ENTRIES_BEFORE_DOUBLING = 50;
/** The price before 2026-11-10, in cents. */
export const PRIOR_PRICE_CENTS = 50000;
/** Anthony's date for a reply asking for fewer blocks (Part L). */
export const DROP_BY = "2026-11-15";

/** "Tuesday, Nov 24" from YYYY-MM-DD. */
export function weekdayMonthDay(ymd: string): string {
  const d = civil(ymd);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${weekday}, ${month} ${d.getUTCDate()}`;
}

export function formatChange(ctx: EmailContext): EmailSpec {
  const c = ctx.common;
  const pay = uniformPayouts(c);
  const price = amount(c.price_per_block_cents);

  return {
    subject: `${POOL_SUBJECT} ${seasonYear(c)} | Your blocks doubled`,
    greeting: "Everyone",
    opening: "Quick update on the TNF block pool. 30 seconds.",
    prose: [
      `1. We have ${ENTRIES_BEFORE_DOUBLING} entries. To fill all ${c.blocks_total} blocks, ` +
        `each block is now ${price} (was ${amount(PRIOR_PRICE_CENTS)}).`,
      `2. Same money, double the blocks. Every ${amount(2 * c.price_per_block_cents)} you put in = 2 blocks.`,
      `3. Every game pays twice, all ${c.games.length} games:`,
      `   Halftime: ${amount(pay.halftimeCents)}`,
      `   Final: ${amount(pay.finalCents)}`,
      "4. How to win: the last digit of each team's score at halftime or the final matches your block.",
      `5. Don't want the extra block? Totally fine. Reply with how many blocks you want by ` +
        `${weekdayMonthDay(DROP_BY)}. You get ${price} back (or owe ${price} less) for each block you drop.`,
      `6. Not paid yet? ${price} a block, due by ${weekdayMonthDay(claimDeadline(c))}.`,
    ],
    rows: [],
    next: `Your block numbers: ${SITE}`,
    deadline: null,
    closing: "Owners: please pass this to your people.",
    signoff: SIGNOFF,
  };
}
