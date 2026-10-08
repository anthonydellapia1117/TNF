// C1: what is on file for one address, as of the day it is sent.
// Event key: holder_checkin_YYYY-MM-DD. Recipients: admin_email_recipients.

import type { EmailContext, EmailSpec, Row } from "../types.ts";
import { amount, andList, hourLabel, longDate, monthDay } from "../format.ts";
import { claimDeadline, firstGame, gameDatesLine, seasonYear, uniformPayouts, ymdOfGame } from "../facts.ts";
import { greetingFor } from "../greeting.ts";
import { BOARD, HOW_A_BLOCK_WINS, POOL_SUBJECT, SIGNOFF, VENMO } from "../copy.ts";
import { REVEAL_TIME_ET } from "../../format.ts";

export function holderCheckin(ctx: EmailContext): EmailSpec {
  const c = ctx.common;
  const h = ctx.holder;
  if (!h || h.blocks.length === 0) {
    throw new Error(`holder_checkin: ${ctx.recipient} holds no committed block`);
  }
  const price = c.price_per_block_cents;
  const pay = uniformPayouts(c);

  const blocks = [...h.blocks].sort((a, b) => a.block_number - b.block_number);
  const owed: number[] = [];
  const rows: Row[] = blocks.map((b) => {
    const id = `Block ${b.block_number}`;
    if (b.status === "assigned") return [id, "Paid"] as const;
    if (b.owner_group === "AVD") {
      owed.push(b.block_number);
      return [id, `Reserved, ${amount(price)} owed`] as const;
    }
    if (!b.owner_full_name) {
      throw new Error(`holder_checkin: block ${b.block_number} is in book ${b.owner_group}, which has no owner name`);
    }
    return [id, `Reserved, through ${b.owner_full_name}`] as const;
  });

  rows.push(
    ["Games", `${c.games.length}, ${gameDatesLine(c)}`],
    ["Halftime", `${amount(pay.halftimeCents)}, every game`],
    ["Final", `${amount(pay.finalCents)}, every game`],
    ["How a block wins", HOW_A_BLOCK_WINS],
    ["Open blocks", `${c.open_count} of ${c.blocks_total}, ${BOARD}`],
  );

  const deadline = owed.length
    ? `${amount(price * owed.length)} owed on ${owed.length === 1 ? "block" : "blocks"} ` +
      `${andList(owed.map(String))}. Venmo ${VENMO} by ${longDate(claimDeadline(c))}. ` +
      "Only a paid block wins."
    : null;

  return {
    subject: `${POOL_SUBJECT} ${seasonYear(c)} | Your blocks | as of ${monthDay(c.as_of_et)}`,
    greeting: greetingFor(h.people),
    opening: "Here is what I have on file for you for the TNF holiday games.",
    rows,
    next:
      `Numbers are drawn at random and posted ${hourLabel(REVEAL_TIME_ET)} the morning of each game, ` +
      `starting ${longDate(ymdOfGame(c, firstGame(c)))}.`,
    deadline,
    signoff: SIGNOFF,
  };
}
