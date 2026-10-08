// A reply to someone who asked which games are in the pool: every game on the
// slate with its date, kickoff in ET and away at home, the open-block count and
// the site, in Anthony's reply voice (CLAUDE.md, Replies). Everything stated is
// read from the database at send time.
//
// Event key: game_list_<Gmail id of the message being answered>. One reply per
// inbound message (index email_sends_one_reply_per_message). Recipients: any
// participant, prospect or owner address; the command checks it is the sender.
// Args: subject (their subject, for "Re:"), filled in by --reply-to; thanks
// ("yes" when the asker said they are selling blocks for the pool, which adds
// "Thanks for pushing it." and is a claim only true of them).

import type { EmailContext, EmailSpec, EventArgs, Row } from "../types.ts";
import { clock, shortDate, teamShort } from "../format.ts";
import { kickoffOf, ymdOfGame } from "../facts.ts";
import { greetingFor } from "../greeting.ts";
import { SIGNOFF, SITE } from "../copy.ts";
import { reSubject } from "./replies.ts";

export const GAME_LIST_KEY = /^game_list_([0-9a-f]+)$/;

export function gameListRows(ctx: EmailContext): Row[] {
  const c = ctx.common;
  if (c.games.length === 0) throw new Error("game_list: no games on the slate");
  return c.games.map((g) => {
    if (!g.date_confirmed) throw new Error(`game_list: G${g.game_no} has no confirmed date; a reply cannot state it`);
    return [
      shortDate(ymdOfGame(c, g)),
      `${clock(kickoffOf(g), c.timezone)} ET, ${teamShort(g.away_team)} at ${teamShort(g.home_team)}`,
    ] as const;
  });
}

export function gameList(ctx: EmailContext, args: EventArgs): EmailSpec {
  const c = ctx.common;
  const n = c.games.length;
  if (args.thanks !== undefined && args.thanks !== "yes") throw new Error(`game_list: --arg thanks=yes or nothing, got "${args.thanks}"`);
  const thanks = args.thanks === "yes" ? "Thanks for pushing it. " : "";
  return {
    subject: reSubject(args.subject),
    greeting: greetingFor(ctx.people ?? []),
    opening: null,
    prose: [`${thanks}Here are all ${n} games, kickoffs ET. ${c.open_count} blocks still open, ${SITE}`],
    rows: gameListRows(ctx),
    next: null,
    deadline: null,
    signoff: SIGNOFF,
  };
}
