// C2: the invitation to take an open block.
// Event key: recruit_YYYY-MM-DD. Recipients: prospects minus holders minus
// Anthony minus exclusions, derived by admin_email_recipients at send time.

import type { EmailContext, EmailSpec } from "../types.ts";
import { amount, clock, hourLabel, longDate, monthDay, teamShort } from "../format.ts";
import {
  chancesToWin, claimDeadline, firstGame, gameDatesLine, kickoffOf, lastGame,
  seasonPayoutCents, seasonYear, uniformPayouts, ymdOfGame,
} from "../facts.ts";
import { BOARD, HOW_A_BLOCK_WINS, POOL_SUBJECT, SIGNOFF, VENMO } from "../copy.ts";
import { REVEAL_TIME_ET } from "../../format.ts";

export function recruit(ctx: EmailContext): EmailSpec {
  const c = ctx.common;
  const pay = uniformPayouts(c);
  const n = c.games.length;
  const first = firstGame(c);
  const last = lastGame(c);
  const range = `${monthDay(ymdOfGame(c, first))} - ${monthDay(ymdOfGame(c, last))}`;

  return {
    subject: `${POOL_SUBJECT} ${seasonYear(c)} | ${n} games, ${range} | ${c.open_count} blocks open`,
    greeting: null,
    opening:
      `The 1622 TNF Block Pool is the ${n} holiday games this year, and ` +
      `${c.open_count} of the ${c.blocks_total} blocks are still open.`,
    rows: [
      ["Block", amount(c.price_per_block_cents)],
      ["Games", `${n}, ${gameDatesLine(c)}`],
      ["Halftime", `${amount(pay.halftimeCents)}, every game`],
      ["Final", `${amount(pay.finalCents)}, every game`],
      ["Chances to win", String(chancesToWin(c))],
      ["Paid out", `${amount(seasonPayoutCents(c))} over the season`],
      ["How a block wins", HOW_A_BLOCK_WINS],
      ["Numbers", `Drawn at random for each game, posted ${hourLabel(REVEAL_TIME_ET)} game day`],
      ["Paid blocks only", "A reserved block that hits pays nothing"],
      ["Pay", `Venmo ${VENMO}, cash, or check`],
      ["Open blocks", BOARD],
    ],
    next:
      `Pick a number on the board and reply with it. Claim by ${longDate(claimDeadline(c))}. ` +
      `First game is ${longDate(ymdOfGame(c, first))}, ${clock(kickoffOf(first), c.timezone)} ET, ` +
      `${teamShort(first.away_team)} at ${teamShort(first.home_team)}.`,
    deadline: null,
    signoff: SIGNOFF,
  };
}
