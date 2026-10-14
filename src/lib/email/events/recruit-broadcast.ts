// G4: the recruit email to everyone, as one message (Anthony, 2026-10-13).
// Event key: recruit_broadcast_YYYY-MM-DD. A broadcast: To is every owner with
// an address, Anthony first; Bcc is every active prospect and every holder
// address, minus To, minus anything excluded, derived by
// admin_email_broadcast_plan at send time. "Everyone," then the recruit facts,
// every game with its kickoff, then the bare URL. Names no holder.

import type { EmailContext, EmailSpec } from "../types.ts";
import { amount, longDate, monthDay } from "../format.ts";
import { claimDeadline, firstGame, lastGame, seasonYear, uniformPayouts, ymdOfGame } from "../facts.ts";
import { HOW_A_BLOCK_WINS, POOL_SUBJECT, SIGNOFF, SITE } from "../copy.ts";
import { gameListRows } from "./game-list.ts";

export const RECRUIT_BROADCAST_KEY = /^recruit_broadcast_(\d{4}-\d{2}-\d{2})$/;

export function recruitBroadcast(ctx: EmailContext): EmailSpec {
  const c = ctx.common;
  const pay = uniformPayouts(c);
  const n = c.games.length;
  const range = `${monthDay(ymdOfGame(c, firstGame(c)))} - ${monthDay(ymdOfGame(c, lastGame(c)))}`;

  return {
    subject: `${POOL_SUBJECT} ${seasonYear(c)} | ${n} games, ${range} | ${c.open_count} blocks open`,
    greeting: "Everyone",
    opening:
      `The 1622 TNF Block Pool is the ${n} holiday games this year, and ` +
      `${c.open_count} of the ${c.blocks_total} blocks are still open.`,
    prose: [
      `A block is ${amount(c.price_per_block_cents)}.`,
      `Every game pays ${amount(pay.halftimeCents)} at halftime and ${amount(pay.finalCents)} at the final.`,
      `How a block wins: ${HOW_A_BLOCK_WINS}`,
      `Claim by ${longDate(claimDeadline(c))}. To claim, reply with how many blocks you want, or which numbers.`,
    ],
    rows: gameListRows(ctx),
    next: SITE,
    deadline: null,
    signoff: SIGNOFF,
  };
}
