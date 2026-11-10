// Part J: the format change to everyone holding a block (Anthony, 2026-11-10).
// Event key: format_change_YYYY-MM-DD. A broadcast, staged as a Gmail draft
// Anthony sends himself: To every owner with an address, Anthony first; Bcc
// every holder address (admin_email_recipients, the game-day set), minus To.
// Every number comes from config: the price and the one payout tier. Names no
// holder and no amount anyone owes.

import type { EmailContext, EmailSpec } from "../types.ts";
import { amount } from "../format.ts";
import { seasonYear, uniformPayouts } from "../facts.ts";
import { POOL_SUBJECT, SIGNOFF, SITE } from "../copy.ts";

export const FORMAT_CHANGE_KEY = /^format_change_(\d{4}-\d{2}-\d{2})$/;

export function formatChange(ctx: EmailContext): EmailSpec {
  const c = ctx.common;
  const pay = uniformPayouts(c);
  const price = amount(c.price_per_block_cents);

  return {
    subject: `${POOL_SUBJECT} ${seasonYear(c)} | ${price} a block, double the blocks`,
    greeting: "Everyone",
    opening:
      `The pool is now ${price} a block, and everyone's block count ` +
      `doubled for the same money.`,
    prose: [
      `Prizes are ${amount(pay.halftimeCents)} at halftime and ${amount(pay.finalCents)} at the final, every game.`,
      `Your new numbers are on ${SITE}.`,
    ],
    rows: [],
    next: null,
    deadline: null,
    signoff: SIGNOFF,
  };
}
