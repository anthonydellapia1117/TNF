// The three game-day emails (Anthony, approved 2026-11-23 2:53 PM ET in the TNF
// PM chat, Part N). Broadcasts: To Anthony, Cc RM and MAP, Bcc every holder's
// own address (dayEnvelope). Every value comes from the database at render
// time; nothing here is a number or a name.
//
//   kickoff_<date>   the day before the first game: board link, how a block
//                    wins, the game-day schedule, unpaid pay by tonight.
//   gameday_<date>   each game date's morning: that day's games, kickoff
//                    times, each game's drawn rows and columns, each grid.
//   winners_<date>   once that day's games are final: per game, halftime and
//                    final score, winning block, name and amount, the grid.
//                    Nothing about payment status: a winning block with no
//                    payout behind it refuses the email, and Anthony decides.
//
// A sample (ctx.sample) is a review copy: SAMPLE in the subject and the
// opening, numbers made up (src/lib/email/sample.ts), only ever a draft To
// Anthony.

import type { BlockListEntry, DayGame, EmailContext, EmailSpec, EventArgs, ImageRef, Row } from "../types.ts";
import { amount, clock, hyphenate, monthDay, shortDate, teamShort } from "../format.ts";
import { claimDeadline, kickoffOf, seasonYear, uniformPayouts, ymdOfGame } from "../facts.ts";
import { BOARD_URL, GRID_URL, HOW_A_BLOCK_WINS, POOL_SUBJECT, SIGNOFF } from "../copy.ts";

export const KICKOFF_KEY = /^kickoff_(\d{4}-\d{2}-\d{2})$/;
export const GAMEDAY_KEY = /^gameday_(\d{4}-\d{2}-\d{2})$/;
export const WINNERS_KEY = /^winners_(\d{4}-\d{2}-\d{2})$/;

const code = (n: number) => `G${String(n).padStart(2, "0")}`;
const SAMPLE_LINE = "SAMPLE for review only. The numbers below are made up.";
const SAMPLE_LIVE_LINE = "SAMPLE for review only, sent to nobody. Everything below is live.";

function keyDate(ctx: EmailContext, re: RegExp, family: string): string {
  const m = re.exec(ctx.event_key);
  if (!m) throw new Error(`${family}: "${ctx.event_key}" is not ${family}_<YYYY-MM-DD>`);
  return m[1];
}

function dayGames(ctx: EmailContext, date: string, family: string): DayGame[] {
  const day = ctx.day;
  if (!day) throw new Error(`${family}: the context has no day facts; fetch admin_email_context('${ctx.event_key}', ...)`);
  if (day.date !== date) throw new Error(`${family}: the day facts are for ${day.date}, not ${date}`);
  if (day.games.length === 0) throw new Error(`${family}: no games on ${date}`);
  return day.games;
}

function subject(ctx: EmailContext, what: string): string {
  return `${ctx.sample ? "SAMPLE - " : ""}${POOL_SUBJECT} ${seasonYear(ctx.common)} | ${what}`;
}

function opening(ctx: EmailContext, line: string, live = false): string {
  return ctx.sample ? `${live ? SAMPLE_LIVE_LINE : SAMPLE_LINE} ${line}` : line;
}

const matchup = (g: { away_team: string; home_team: string }) => `${teamShort(g.away_team)} at ${teamShort(g.home_team)}`;

export function kickoff(ctx: EmailContext): EmailSpec {
  const date = keyDate(ctx, KICKOFF_KEY, "kickoff");
  const c = ctx.common;
  const pay = uniformPayouts(c);
  if (c.games.length === 0) throw new Error("kickoff: no games on the slate");
  const rows: Row[] = [
    ["Board", BOARD_URL],
    ["How a block wins", HOW_A_BLOCK_WINS],
    ["Every game pays", `Halftime ${amount(pay.halftimeCents)}, final ${amount(pay.finalCents)}`],
    ["Numbers", "Drawn the morning of each game day and emailed to you"],
  ];
  for (const g of c.games) {
    if (!g.date_confirmed) throw new Error(`kickoff: ${code(g.game_no)} has no confirmed date; the schedule cannot state it`);
    rows.push([shortDate(ymdOfGame(c, g)), `${code(g.game_no)}, ${clock(kickoffOf(g), c.timezone)} ET, ${matchup(g)}`]);
  }
  const deadline = claimDeadline(c);
  if (date !== deadline) throw new Error(`kickoff: ${ctx.event_key} is not the claim deadline (${deadline}); the kickoff goes on that date only`);
  const first = c.games[0];
  return {
    subject: subject(ctx, `Game days start ${monthDay(ymdOfGame(c, first))}`),
    greeting: "Everyone",
    opening: opening(ctx, `The holiday pool starts ${shortDate(ymdOfGame(c, first))}. Here is how it runs.`, true),
    rows,
    next: `Numbers for ${code(first.game_no)} come out the morning of ${shortDate(ymdOfGame(c, first))}.`,
    deadline: `Not paid yet? ${amount(c.price_per_block_cents)} a block, due by 11:59 PM ${shortDate(deadline)}. Only a paid block wins.`,
    signoff: SIGNOFF,
  };
}

/**
 * The 100 lines of the game-day email's block list (Anthony, 2026-11-25, Part R):
 * "<block> - <board name> (<real name, only if different>) - <email, or 'no
 * email on file'>", block 1 to 100. Every value comes from the file the
 * command is handed; nothing here is a name or an address.
 */
export function blockListLines(entries: readonly BlockListEntry[]): string[] {
  const by = new Map<number, BlockListEntry>();
  for (const e of entries) {
    if (!Number.isInteger(e.block) || e.block < 1 || e.block > 100) throw new Error(`block list: block ${e.block} is not 1 to 100`);
    if (by.has(e.block)) throw new Error(`block list: block ${e.block} appears twice`);
    by.set(e.block, e);
  }
  const lines: string[] = [];
  for (let n = 1; n <= 100; n++) {
    const e = by.get(n);
    if (!e) throw new Error(`block list: block ${n} is missing; the list is all 100 blocks`);
    const board = e.board?.trim() ? hyphenate(e.board.trim()) : null;
    if (!board) {
      lines.push(`${n} - open`);
      continue;
    }
    const real = e.real?.trim() ?? "";
    const different = real !== "" && real.toLowerCase() !== board.toLowerCase() && hyphenate(real).toLowerCase() !== board.toLowerCase();
    const email = e.email?.trim() ? e.email.trim().toLowerCase() : "no email on file";
    lines.push(`${n} - ${board}${different ? ` (${hyphenate(real)})` : ""} - ${email}`);
  }
  return lines;
}

const gridCid = (n: number) => `grid-${code(n).toLowerCase()}@tnf`;

export function gameday(ctx: EmailContext, args: EventArgs = {}): EmailSpec {
  const date = keyDate(ctx, GAMEDAY_KEY, "gameday");
  const c = ctx.common;
  const games = dayGames(ctx, date, "gameday");
  const rows: Row[] = [];
  for (const g of games) {
    if (!g.published || !g.row_digits || !g.col_digits) {
      throw new Error(`gameday: ${code(g.game_no)} digits are not published; the email cannot state them`);
    }
    if (g.digits_ok !== true) throw new Error(`gameday: ${code(g.game_no)} digits do not match their draw row; send nothing`);
    if (g.row_digits.length !== 10 || g.col_digits.length !== 10) throw new Error(`gameday: ${code(g.game_no)} digits are not a full permutation`);
    const net = g.network ? `, ${hyphenate(g.network)}` : "";
    rows.push(
      [code(g.game_no), `${matchup(g)}, ${clock(g.kickoff_at, c.timezone)} ET${net}`],
      [`Rows, ${teamShort(g.away_team)} (away)`, g.row_digits.join(" ")],
      [`Columns, ${teamShort(g.home_team)} (home)`, g.col_digits.join(" ")],
      // One link for every game (Part Q): /grid opens on today's game. With the
      // block list (Part R) the link closes the list's introduction instead.
      ...(ctx.block_list ? [] : ([["Grid", GRID_URL]] as Row[])),
    );
  }
  const n = games.length;
  // Part R: a grid picture per game (Comfortable view, names in every block)
  // and all 100 blocks, ahead of the closing line. Present only when the
  // command was handed the block list; without it the email is the Part N
  // template, word for word. --arg images=off keeps the list and drops the
  // pictures (the routine's fallback when a picture cannot be fetched).
  const list = ctx.block_list ? blockListLines(ctx.block_list) : undefined;
  const images: ImageRef[] | undefined = list && args.images !== "off"
    ? games.map((g) => ({ cid: gridCid(g.game_no), gameNo: g.game_no, alt: `${code(g.game_no)} grid, ${matchup(g)}` }))
    : undefined;
  return {
    subject: subject(ctx, `Game day numbers | ${monthDay(date)}`),
    greeting: "Everyone",
    opening: opening(ctx, n === 1 ? `Numbers are in for the ${shortDate(date)} game.` : `Numbers are in for the ${n} games on ${shortDate(date)}.`),
    rows,
    ...(images ? { images } : {}),
    ...(list
      ? {
          listIntro: [
            `Live grid with a name search: ${GRID_URL}`,
            "Every block in order: the block number, the name on the board, the real name if it is different, and the email on file.",
          ],
          list,
        }
      : {}),
    next: n === 1 ? "Winners go out after the game ends." : "Winners go out after the last game ends.",
    deadline: null,
    signoff: SIGNOFF,
  };
}

export function winners(ctx: EmailContext): EmailSpec {
  const date = keyDate(ctx, WINNERS_KEY, "winners");
  const c = ctx.common;
  const pay = uniformPayouts(c);
  const games = dayGames(ctx, date, "winners");
  const rows: Row[] = [];
  for (const g of games) {
    const scored = [g.halftime_away, g.halftime_home, g.final_away, g.final_home, g.halftime_block, g.final_block]
      .every((x) => typeof x === "number");
    if (!scored) throw new Error(`winners: ${code(g.game_no)} is not scored; send nothing`);
    if (!g.halftime_paid_out || !g.final_paid_out) {
      throw new Error(`winners: ${code(g.game_no)} has a winning block with no payout behind it; Anthony's call, send nothing`);
    }
    if (!g.halftime_name || !g.final_name) throw new Error(`winners: ${code(g.game_no)} has a winning block with no name`);
    const a = teamShort(g.away_team);
    const h = teamShort(g.home_team);
    rows.push(
      [code(g.game_no), matchup(g)],
      ["Halftime", `${a} ${g.halftime_away}, ${h} ${g.halftime_home} - block ${g.halftime_block}, ${hyphenate(g.halftime_name)} - ${amount(pay.halftimeCents)}`],
      ["Final", `${a} ${g.final_away}, ${h} ${g.final_home} - block ${g.final_block}, ${hyphenate(g.final_name)} - ${amount(pay.finalCents)}`],
      // One link for every game (Part Q): /grid opens on today's game.
      ["Grid", GRID_URL],
    );
  }
  const later = c.games.filter((g) => ymdOfGame(c, g) > date);
  const next = later.length
    ? `Next game day is ${shortDate(ymdOfGame(c, later[0]))}.`
    : `That was the last game of the ${seasonYear(c)} pool.`;
  return {
    subject: subject(ctx, `Winners | ${monthDay(date)}`),
    greeting: "Everyone",
    opening: opening(ctx, `Here are the winners for ${shortDate(date)}.`),
    rows,
    next,
    deadline: null,
    signoff: SIGNOFF,
  };
}
