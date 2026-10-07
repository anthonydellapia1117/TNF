// The game-day pack: one game, its grid, a draft Anthony sends himself.
// Event key: game_day_G<NN>. Args: grid (links | attached | live-only),
// png_url and pdf_url when grid is links.
//
// The subject names the game and its date, and the attachment files are named
// from the subject (attachmentBase), so the two always match.

import type { EmailContext, EmailSpec, EventArgs, Row } from "../types.ts";
import { amount, clock, hourLabel, hyphenate, longDate, monthDay, teamShort } from "../format.ts";
import { kickoffOf, seasonYear, uniformPayouts, ymdOfGame } from "../facts.ts";
import { HOW_A_BLOCK_WINS, POOL_SUBJECT, SIGNOFF, SITE_URL } from "../copy.ts";
import { REVEAL_TIME_ET } from "../../format.ts";

export const GAME_DAY_KEY = /^game_day_g(\d{2})$/;

export function gameCode(n: number): string {
  return `G${String(n).padStart(2, "0")}`;
}

/** "TNF Holiday Pool 2026 | G01 grid | Nov 25" -> "TNF_Holiday_Pool_2026_G01_grid_Nov_25" */
export function attachmentBase(subject: string): string {
  return subject.replace(/\s*\|\s*/g, "_").replace(/\s+/g, "_").replace(/[^A-Za-z0-9_-]/g, "");
}

export function gameDay(ctx: EmailContext, args: EventArgs): EmailSpec {
  const m = GAME_DAY_KEY.exec(ctx.event_key);
  if (!m) throw new Error(`game_day: "${ctx.event_key}" is not game_day_g<NN>`);
  const c = ctx.common;
  const no = Number(m[1]);
  const i = c.games.findIndex((g) => g.game_no === no);
  if (i < 0) throw new Error(`game_day: ${gameCode(no)} is not on the slate`);
  const g = c.games[i];
  const ymd = ymdOfGame(c, g);
  const pay = uniformPayouts(c);
  const code = gameCode(no);
  const live = `${SITE_URL}/grid?g=${no}`;

  const rows: Row[] = [
    ["Game", g.holiday_label ? `${code}, ${hyphenate(g.holiday_label)}` : code],
    ["Matchup", `${hyphenate(g.away_team)} at ${hyphenate(g.home_team)}`],
    ["Kickoff", `${longDate(ymd)}, ${clock(kickoffOf(g), c.timezone)} ET`],
  ];
  if (g.network) rows.push(["Network", hyphenate(g.network)]);
  rows.push(["Live grid", live]);
  const grid = args.grid ?? "live-only";
  if (grid === "links") {
    if (!args.png_url || !args.pdf_url) throw new Error("game_day: grid=links needs png_url and pdf_url");
    rows.push(["Grid PNG", args.png_url], ["Grid PDF", args.pdf_url]);
  } else if (grid === "attached") {
    rows.push(["Grid files", "Attached, PNG and PDF"]);
  } else if (grid !== "live-only") {
    throw new Error(`game_day: grid must be links, attached or live-only, got "${grid}"`);
  }
  rows.push(
    ["Numbers", `Posted ${hourLabel(REVEAL_TIME_ET)} ${longDate(ymd)}`],
    ["Halftime", amount(pay.halftimeCents)],
    ["Final", amount(pay.finalCents)],
    ["How a block wins", HOW_A_BLOCK_WINS],
  );

  const nextGame = c.games[i + 1];
  const next = nextGame
    ? `Next game is ${gameCode(nextGame.game_no)}, ${longDate(ymdOfGame(c, nextGame))}, ` +
      `${clock(kickoffOf(nextGame), c.timezone)} ET, ` +
      `${teamShort(nextGame.away_team)} at ${teamShort(nextGame.home_team)}.`
    : `This is the last game of the ${seasonYear(c)} pool.`;

  return {
    subject: `${POOL_SUBJECT} ${seasonYear(c)} | ${code} grid | ${monthDay(ymd)}`,
    greeting: null,
    opening: `Here is the grid for ${code}, ${teamShort(g.away_team)} at ${teamShort(g.home_team)}, ${longDate(ymd)}.`,
    rows,
    next,
    deadline: null,
    signoff: SIGNOFF,
  };
}
