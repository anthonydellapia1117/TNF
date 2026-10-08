// The sweep's reply allowlist, T1-T7 (docs/SWEEP_PROMPT.md section 10). The
// wording is Anthony's and is kept verbatim; only the rendering moved here,
// and the numbers in it are read from the database instead of typed. The one
// change to the words: no dollar sign anywhere, so "$500" is written "500".
//
// Event key: reply_t<1-7>_<gmail thread id>. email_sends allows one reply
// per thread whatever the template (index email_sends_one_reply_per_thread):
// "never twice to the same thread".
// Args: subject (their subject, for "Re:"), block (T1 and T2).

import type { EmailContext, EmailSpec, EventArgs } from "../types.ts";
import { amount, weekdaySlash } from "../format.ts";
import { firstGame, uniformPayouts, ymdOfGame } from "../facts.ts";
import { BOARD_URL, SIGNOFF, VENMO } from "../copy.ts";

export const REPLY_KEY = /^reply_t([1-7])_([a-z0-9]+)$/;

/** "Re: <their subject>", once. Shared by every reply to an inbound message. */
export function reSubject(theirs: string | undefined): string {
  const s = (theirs ?? "").trim();
  if (!s) throw new Error("reply: --subject (their subject line) is required");
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

function blockArg(ctx: EmailContext, args: EventArgs): { n: number; open: boolean } {
  const n = Number(args.block);
  if (!Number.isInteger(n) || n < 1 || n > ctx.common.blocks_total) {
    throw new Error(`reply: --block must be 1 to ${ctx.common.blocks_total}, got "${args.block ?? ""}"`);
  }
  const row = ctx.blocks?.find((b) => b.block_number === n);
  if (!row) throw new Error(`reply: the context carries no status for block ${n}; render from admin_email_context`);
  return { n, open: row.status === "available" };
}

export function replyLines(t: number, ctx: EmailContext, args: EventArgs): string[] {
  const c = ctx.common;
  const price = amount(c.price_per_block_cents);
  const pay = uniformPayouts(c);
  const half = amount(pay.halftimeCents);
  const fin = amount(pay.finalCents);
  const first = weekdaySlash(ymdOfGame(c, firstGame(c)));
  const games = c.games.length;

  switch (t) {
    case 1: {
      const b = blockArg(ctx, args);
      if (!b.open) throw new Error(`T1: block ${b.n} is not open in this run; send T2 instead, never both`);
      return [
        `You're in on block ${b.n}. ${price}, Venmo ${VENMO}, or cash or check works.`,
        `First game is Thanksgiving Eve, ${first}. ${games} holiday games, ${half} halftime and ${fin} final on every one.`,
        `Board: ${BOARD_URL}`,
      ];
    }
    case 2: {
      const b = blockArg(ctx, args);
      if (b.open) throw new Error(`T2: block ${b.n} is open in this run; that is T1`);
      return [
        `Block ${b.n} is gone. Open ones are on the board, tell me which and it's yours.`,
        BOARD_URL,
      ];
    }
    case 3:
      return ["Got it, thanks. I'll confirm once I see it land."];
    case 4:
      return [
        "No problem at all, thanks for telling me. I'll get your money back to you and free the block up. Nothing owed.",
      ];
    case 5:
      return [
        `Yeah, it changed. It's the ${games} holiday games only now, not all 23. Nothing happens until Thanksgiving Eve, ${first}.`,
        `Same ${price} a block. Payouts went up to ${half} halftime and ${fin} final, every game.`,
        "Your block number is the same. If you paid, you're paid. The numbers posted for the two September games are void, fresh ones get drawn the morning of each game.",
        BOARD_URL,
      ];
    case 6:
      return [`${price} a block. Venmo ${VENMO}, or cash or check, whatever's easier.`];
    case 7:
      throw new Error("T7 is no reply: stage unparsed_intake and send nothing");
    default:
      throw new Error(`no reply template T${t}`);
  }
}

export function reply(ctx: EmailContext, args: EventArgs): EmailSpec {
  const m = REPLY_KEY.exec(ctx.event_key);
  if (!m) throw new Error(`reply: "${ctx.event_key}" is not reply_t<1-7>_<thread id>`);
  return {
    subject: reSubject(args.subject),
    greeting: null,
    opening: null,
    prose: replyLines(Number(m[1]), ctx, args),
    rows: [],
    next: null,
    deadline: null,
    signoff: SIGNOFF,
  };
}
