import { describe, expect, it } from "vitest";
import { renderEvent } from "@/lib/email";
import { buildMime } from "@/lib/email/mime";
import { attachmentBase } from "@/lib/email/events/game-day";
import { firstNameOf, greetingFor } from "@/lib/email/greeting";
import { wrap, wrapRow } from "@/lib/email/wrap";
import { gameDatesLine, seasonPayoutCents, uniformPayouts } from "@/lib/email/facts";
import type { HolderFacts } from "@/lib/email/types";
import { ALL_BLOCKS, ASKER, COMMON, ctx, DIGEST, SAMPLE_HOLDER } from "./fixtures";

const holder = (h: HolderFacts) => renderEvent(ctx("holder_checkin_2026-10-07", { holder: h }));

describe("C1 holder check-in", () => {
  it("renders the sample exactly: Anthony holding 5 (reserved, AVD) and 3 (paid)", () => {
    const r = holder(SAMPLE_HOLDER);
    expect(r.email.subject).toBe("TNF Holiday Pool 2026 | Your blocks | as of Oct 7");
    expect(r.email.text).toBe(
      [
        "Anthony,",
        "",
        "Here is what I have on file for you for the TNF holiday games.",
        "",
        "Block 3: Paid",
        "Block 5: Reserved, 500 owed",
        "Games: 10, Nov 25, 26, 27 / Dec 24, 25 / Dec 31",
        "Halftime: 1,500, every game",
        "Final: 3,000, every game",
        "How a block wins: Last digit of each team's score. Away digit picks",
        "  the row, home digit picks the column.",
        "Open blocks: 42 of 100, ad-26-tnf.vercel.app/blocks",
        "",
        "Numbers are drawn at random and posted 8 AM the morning of each game,",
        "starting Wed Nov 25, 2026.",
        "",
        "500 owed on block 5. Venmo @AnthonyDellaPia by Tue Nov 24, 2026. Only",
        "a paid block wins.",
        "",
        "Anthony",
        "",
      ].join("\n"),
    );
    expect(r.problems).toEqual([]);
  });

  it("names the other owner for a block in his book, never the word owed, and no deadline", () => {
    const r = holder({
      people: [{ full_name: "Jane Holder", display_alias: "JH", via: "primary", owner_group: "RM" }],
      blocks: [{ block_number: 12, status: "reserved", owner_group: "RM", owner_full_name: "Ronnie Malandro" }],
    });
    expect(r.spec.rows[0]).toEqual(["Block 12", "Reserved, through Ronnie Malandro"]);
    expect(r.email.text).not.toMatch(/owed/);
    expect(r.spec.deadline).toBeNull();
    expect(r.spec.greeting).toBe("Jane");
  });

  it("sums the owed blocks and pluralises the list", () => {
    const r = holder({
      people: [{ full_name: "Ed D", display_alias: null, via: "primary", owner_group: "AVD" }],
      blocks: [
        { block_number: 9, status: "reserved", owner_group: "AVD", owner_full_name: "Anthony DellaPia" },
        { block_number: 5, status: "reserved", owner_group: "AVD", owner_full_name: "Anthony DellaPia" },
        { block_number: 40, status: "assigned", owner_group: "AVD", owner_full_name: "Anthony DellaPia" },
      ],
    });
    expect(r.spec.rows.slice(0, 3).map((x) => x[0])).toEqual(["Block 5", "Block 9", "Block 40"]);
    expect(r.spec.deadline).toBe(
      "1,000 owed on blocks 5 and 9. Venmo @AnthonyDellaPia by Tue Nov 24, 2026. Only a paid block wins.",
    );
  });

  it("refuses a block in a book with no owner name rather than printing a blank", () => {
    expect(() =>
      holder({ people: [], blocks: [{ block_number: 1, status: "reserved", owner_group: "NL", owner_full_name: null }] }),
    ).toThrow(/no owner name/);
  });

  it("refuses an address that holds nothing", () => {
    expect(() => holder({ people: [], blocks: [] })).toThrow(/holds no committed block/);
  });

  it("reads the open count and the deadline from the database", () => {
    const r = renderEvent(ctx("holder_checkin_2026-10-07", {
      holder: SAMPLE_HOLDER,
      common: { ...COMMON, open_count: 17, claim_deadline: "2026-11-20" },
    }));
    expect(r.email.text).toContain("Open blocks: 17 of 100");
    expect(r.spec.deadline).toContain("Fri Nov 20, 2026");
  });
});

describe("greeting", () => {
  it("is the first name only when it is certainly right", () => {
    expect(firstNameOf("Raychel Neil")).toBe("Raychel");
    expect(firstNameOf("Cher")).toBeNull();
    expect(firstNameOf("Mike & Sue Smith")).toBeNull();
    expect(firstNameOf("Tom and Jerry")).toBeNull();
    expect(firstNameOf("Economy Delivery")).toBeNull();
    expect(firstNameOf("Joe's Poultry")).toBeNull();
    expect(firstNameOf("J. Smith")).toBeNull();
  });

  it("is omitted for a cc, and for one address reaching two different first names", () => {
    const p = (full_name: string, via: "primary" | "cc" = "primary") => ({ full_name, display_alias: null, via, owner_group: "AVD" });
    expect(greetingFor([p("Sam Share"), p("Pat Share")])).toBeNull();
    expect(greetingFor([p("Sam Share"), p("Sam Share")])).toBe("Sam");
    expect(greetingFor([p("Raychel Neil", "cc")])).toBeNull();
    expect(greetingFor([])).toBeNull();
  });
});

describe("C2 recruit", () => {
  it("renders exactly, every number derived", () => {
    const r = renderEvent(ctx("recruit_2026-10-07"));
    expect(r.email.subject).toBe("TNF Holiday Pool 2026 | 10 games, Nov 25 - Dec 31 | 42 blocks open");
    expect(r.email.text).toBe(
      [
        "The 1622 TNF Block Pool is the 10 holiday games this year, and 42 of",
        "the 100 blocks are still open.",
        "",
        "Block: 500",
        "Games: 10, Nov 25, 26, 27 / Dec 24, 25 / Dec 31",
        "Halftime: 1,500, every game",
        "Final: 3,000, every game",
        "Chances to win: 20",
        "Paid out: 45,000 over the season",
        "How a block wins: Last digit of each team's score. Away digit picks",
        "  the row, home digit picks the column.",
        "Numbers: Drawn at random for each game, posted 8 AM game day",
        "Paid blocks only: A reserved block that hits pays nothing",
        "Pay: Venmo @AnthonyDellaPia, cash, or check",
        "Open blocks: ad-26-tnf.vercel.app/blocks",
        "",
        "Pick a number on the board and reply with it. Claim by Tue Nov 24,",
        "2026. First game is Wed Nov 25, 2026, 8:00 PM ET, Packers at Rams.",
        "",
        "Anthony",
        "",
      ].join("\n"),
    );
    expect(r.spec.greeting).toBeNull();
    expect(r.spec.deadline).toBeNull();
  });

  it("follows the database: fewer games, a different payout, a different open count", () => {
    const common = {
      ...COMMON,
      open_count: 3,
      holiday_halftime_cents: 100000,
      regular_halftime_cents: 100000,
      games: COMMON.games.slice(0, 5),
    };
    const r = renderEvent(ctx("recruit_2026-10-07", { common }));
    expect(r.email.subject).toBe("TNF Holiday Pool 2026 | 5 games, Nov 25 - Nov 27 | 3 blocks open");
    expect(r.spec.rows).toContainEqual(["Chances to win", "10"]);
    expect(r.spec.rows).toContainEqual(["Paid out", "20,000 over the season"]);
    expect(r.spec.rows).toContainEqual(["Halftime", "1,000, every game"]);
  });

  it("refuses to say 'every game' when two games pay differently", () => {
    const common = {
      ...COMMON,
      regular_final_cents: 200000,
      games: [...COMMON.games.slice(0, 9), { ...COMMON.games[9], game_type: "regular" }],
    };
    expect(() => uniformPayouts(common)).toThrow(/different amounts/);
  });

  it("derives the season totals", () => {
    expect(seasonPayoutCents(COMMON)).toBe(4_500_000);
    expect(gameDatesLine(COMMON)).toBe("Nov 25, 26, 27 / Dec 24, 25 / Dec 31");
  });
});

describe("sweep replies T1-T7, wording verbatim from docs/SWEEP_PROMPT.md as of 2026-09-10, no dollar sign", () => {
  const lines = (key: string, args: Record<string, string>) =>
    renderEvent(ctx(key, { blocks: ALL_BLOCKS }), args).spec.prose;

  it("T1", () => {
    expect(lines("reply_t1_abc", { subject: "TNF", block: "7" })).toEqual([
      "You're in on block 7. 500, Venmo @AnthonyDellaPia, or cash or check works.",
      "First game is Thanksgiving Eve, Wed 11/25. 10 holiday games, 1,500 halftime and 3,000 final on every one.",
      "Board: https://ad-26-tnf.vercel.app/blocks",
    ]);
  });
  it("T2", () => {
    expect(lines("reply_t2_abc", { subject: "TNF", block: "8" })).toEqual([
      "Block 8 is gone. Open ones are on the board, tell me which and it's yours.",
      "https://ad-26-tnf.vercel.app/blocks",
    ]);
  });
  it("T3, T4, T6", () => {
    expect(lines("reply_t3_abc", { subject: "x" })).toEqual(["Got it, thanks. I'll confirm once I see it land."]);
    expect(lines("reply_t4_abc", { subject: "x" })).toEqual([
      "No problem at all, thanks for telling me. I'll get your money back to you and free the block up. Nothing owed.",
    ]);
    expect(lines("reply_t6_abc", { subject: "x" })).toEqual([
      "500 a block. Venmo @AnthonyDellaPia, or cash or check, whatever's easier.",
    ]);
  });
  it("T5", () => {
    expect(lines("reply_t5_abc", { subject: "x" })).toEqual([
      "Yeah, it changed. It's the 10 holiday games only now, not all 23. Nothing happens until Thanksgiving Eve, Wed 11/25.",
      "Same 500 a block. Payouts went up to 1,500 halftime and 3,000 final, every game.",
      "Your block number is the same. If you paid, you're paid. The numbers posted for the two September games are void, fresh ones get drawn the morning of each game.",
      "https://ad-26-tnf.vercel.app/blocks",
    ]);
  });
  it("signs off Anthony, answers Re: their subject once, and has no greeting", () => {
    const r = renderEvent(ctx("reply_t3_abc"), { subject: "Re: paid" });
    expect(r.email.subject).toBe("Re: paid");
    expect(renderEvent(ctx("reply_t3_abc"), { subject: "paid" }).email.subject).toBe("Re: paid");
    expect(r.email.text.trimEnd().endsWith("\n\nAnthony")).toBe(true);
    expect(r.spec.greeting).toBeNull();
  });
  it("refuses T1 on a taken block, T2 on an open one, and T7 always", () => {
    expect(() => lines("reply_t1_abc", { subject: "x", block: "8" })).toThrow(/send T2 instead/);
    expect(() => lines("reply_t2_abc", { subject: "x", block: "7" })).toThrow(/that is T1/);
    expect(() => lines("reply_t7_abc", { subject: "x" })).toThrow(/no reply/);
    expect(() => lines("reply_t1_abc", { subject: "x", block: "101" })).toThrow(/--block/);
    expect(() => renderEvent(ctx("reply_t1_abc"), { subject: "x", block: "7" })).toThrow(/no status for block/);
  });
});

describe("registry", () => {
  it("renders a dated event only on the database's own date", () => {
    expect(() => renderEvent(ctx("recruit_2026-10-08"))).toThrow(/database date is 2026-10-07/);
  });
  it("refuses an unknown event", () => {
    expect(() => renderEvent(ctx("blast_2026-10-07"))).toThrow(/no email event/);
  });
});

describe("digest", () => {
  const r = renderEvent(ctx("digest_2026-10-07", { digest: DIGEST }));
  it("leads with each owner who has no address, then the AVD chase, the queue and the writes, then the three checks", () => {
    expect(r.email.subject).toBe("TNF DIGEST 2026-10-07");
    expect(r.spec.rows[0]).toEqual(["NEEDS ANTHONY", "DN Dom Novelli has no address; the next broadcast refuses until it is set."]);
    expect(r.spec.rows[1]).toEqual(["Block 5", "Reserved, no payment recorded by the pool, Anthony DellaPia"]);
    expect(r.spec.rows.map((x) => x[0])).toEqual([
      "NEEDS ANTHONY", "Block 5", "Queue unclassified_mail", "Queue payment", "Write 7:43 PM", "Check 7a", "Check 7b", "Check 7c",
    ]);
    expect(r.spec.rows[3][1]).toBe("Jane Holder, 500");
    expect(r.spec.next).toBe("Next digest: Thu Oct 8, 2026, 10:43 PM ET.");
  });
  it("never prints a dollar sign or an address out of a payload", () => {
    expect(r.email.text).not.toMatch(/\$|@tnf\.test/);
    expect(r.problems).toEqual([]);
  });
  it("quotes a queue row's own words without the reply-voice lint refusing the digest", () => {
    const q = { id: "q9", kind: "unclassified_mail", payload: { subject: "let me know if 30 is open" } };
    const quoted = renderEvent(ctx("digest_2026-10-07", { digest: { ...DIGEST, open_queue: [q] } }));
    expect(quoted.email.text).toMatch(/let me know if 30 is open/);
    expect(quoted.problems).toEqual([]);
  });
  it("carries no NEEDS ANTHONY line once every owner has an address", () => {
    const ok = renderEvent(ctx("digest_2026-10-07", { digest: { ...DIGEST, owners_missing_email: [] } }));
    expect(ok.spec.rows.some((x) => x[0] === "NEEDS ANTHONY")).toBe(false);
  });
  it("fails 7a on a broken total", () => {
    const bad = renderEvent(ctx("digest_2026-10-07", { digest: { ...DIGEST, block_counts: { ...DIGEST.block_counts, held: 1 } } }));
    expect(bad.spec.rows.find((x) => x[0] === "Check 7a")?.[1]).toMatch(/^FAIL/);
  });
});

describe("game list reply", () => {
  const r = renderEvent(ctx("game_list_1a116ebc30d629eb", { people: ASKER }), { subject: "Re: TNF Holiday Pool 2026 | Your blocks | as of Oct 7", thanks: "yes" });
  it("is a first name, three short sentences, one row per game, signed Anthony", () => {
    expect(r.email.subject).toBe("Re: TNF Holiday Pool 2026 | Your blocks | as of Oct 7");
    expect(r.email.text).toBe(
      [
        "Dan,",
        "",
        "Thanks for pushing it. Here are all 10 games, kickoffs ET. 42 blocks",
        "still open, ad-26-tnf.vercel.app",
        "",
        "Wed Nov 25: 8:00 PM ET, Packers at Rams",
        "Thu Nov 26: 1:00 PM ET, Bears at Lions",
        "Thu Nov 26: 4:30 PM ET, Eagles at Cowboys",
        "Thu Nov 26: 8:20 PM ET, Chiefs at Bills",
        "Fri Nov 27: 3:00 PM ET, Broncos at Steelers",
        "Thu Dec 24: 8:15 PM ET, Texans at Eagles",
        "Fri Dec 25: 1:00 PM ET, Packers at Bears",
        "Fri Dec 25: 4:30 PM ET, Bills at Broncos",
        "Fri Dec 25: 8:15 PM ET, Rams at Seahawks",
        "Thu Dec 31: 8:15 PM ET, Ravens at Bengals",
        "",
        "Anthony",
        "",
      ].join("\n"),
    );
    expect(r.problems).toEqual([]);
  });
  it("thanks only someone who said they are selling blocks", () => {
    const plain = renderEvent(ctx("game_list_ab", { people: ASKER }), { subject: "x" });
    expect(plain.spec.prose).toEqual(["Here are all 10 games, kickoffs ET. 42 blocks still open, ad-26-tnf.vercel.app"]);
    expect(() => renderEvent(ctx("game_list_ab"), { subject: "x", thanks: "sure" })).toThrow(/thanks=yes or nothing/);
  });
  it("links the site as the bare URL and nothing else", () => {
    expect(r.email.html).toContain('<a href="https://ad-26-tnf.vercel.app" style="color:#1a4fa0;">ad-26-tnf.vercel.app</a>');
  });
  it("refuses a game with no confirmed date rather than state one", () => {
    const games = COMMON.games.map((g, i) => (i === 3 ? { ...g, date_confirmed: false } : g));
    expect(() => renderEvent({ ...ctx("game_list_ab"), common: { ...COMMON, games } }, { subject: "x" })).toThrow(/G4 has no confirmed date/);
  });
  it("greets no one when the address reaches a cc", () => {
    const cc = renderEvent(ctx("game_list_ab", { people: [{ ...ASKER[0], via: "cc" }] }), { subject: "x" });
    expect(cc.spec.greeting).toBeNull();
  });
});

describe("answer reply", () => {
  it("is the caller's sentences, first name first, signed Anthony", () => {
    const r = renderEvent(ctx("answer_ab12", { people: ASKER }), { subject: "q", lines: "Block 30 is yours. Paid in full." });
    expect(r.email.subject).toBe("Re: q");
    expect(r.email.text).toBe("Dan,\n\nBlock 30 is yours. Paid in full.\n\nAnthony\n");
    expect(r.problems).toEqual([]);
  });
  it("refuses more than three sentences, and no lines", () => {
    expect(() => renderEvent(ctx("answer_ab12"), { subject: "q", lines: "One. Two. Three. Four." })).toThrow(/4 sentences/);
    expect(() => renderEvent(ctx("answer_ab12"), { subject: "q" })).toThrow(/--lines is required/);
  });
  it("is refused by lint for filler or a dollar sign", () => {
    expect(renderEvent(ctx("answer_ab12"), { subject: "q", lines: "Done. Let me know if you need anything." }).problems)
      .toContain('text: filler ("Let me know if")');
    expect(renderEvent(ctx("answer_ab12"), { subject: "q", lines: "It is $500." }).problems.join()).toMatch(/dollar sign/);
  });
});

describe("status report", () => {
  it("is the standing format: the lines as rows, no greeting, no sign-off", () => {
    const r = renderEvent(ctx("status_x"), { lines: "SESSION: a\nBLOCKED: none" });
    expect(r.email.subject).toBe("TNF CODE STATUS - V2");
    expect(r.email.text).toBe("SESSION: a\nBLOCKED: none\n");
    expect(() => renderEvent(ctx("status_x"), { lines: "no colon" })).toThrow(/KEY: value/);
  });
});

describe("game day", () => {
  it("names the game and date in the subject, and the files after the subject", () => {
    const r = renderEvent(ctx("game_day_g01"), { grid: "attached" });
    expect(r.email.subject).toBe("TNF Holiday Pool 2026 | G01 grid | Nov 25");
    expect(attachmentBase(r.email.subject)).toBe("TNF_Holiday_Pool_2026_G01_grid_Nov_25");
    expect(r.spec.rows).toContainEqual(["Kickoff", "Wed Nov 25, 2026, 8:00 PM ET"]);
    expect(r.spec.next).toBe("Next game is G02, Thu Nov 26, 2026, 1:00 PM ET, Bears at Lions.");
  });
  it("links both files when the grid is uploaded, and closes the season on G10", () => {
    const r = renderEvent(ctx("game_day_g10"), { grid: "links", png_url: "https://x.test/a.png", pdf_url: "https://x.test/a.pdf" });
    expect(r.spec.rows).toContainEqual(["Grid PNG", "https://x.test/a.png"]);
    expect(r.spec.rows).toContainEqual(["Kickoff", "Thu Dec 31, 2026, 8:15 PM ET"]);
    expect(r.spec.next).toBe("This is the last game of the 2026 pool.");
    expect(() => renderEvent(ctx("game_day_g11"), {})).toThrow(/not on the slate/);
  });
});

describe("layout", () => {
  it("wraps under 70 with a two-space hanging indent on rows", () => {
    for (const l of wrap("word ".repeat(60))) expect(l.length).toBeLessThan(70);
    const rows = wrapRow("Label", "x ".repeat(60));
    expect(rows.slice(1).every((l) => l.startsWith("  ") && !l.startsWith("   "))).toBe(true);
  });
  it("puts the substance in one 560px table with numbers right-aligned and the link as its own bare URL", () => {
    const html = renderEvent(ctx("recruit_2026-10-07")).email.html;
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toContain("max-width:560px");
    expect(html).toContain("width:100%");
    expect(html).toMatch(/text-align:right;">500</);
    expect(html).toContain('<a href="https://ad-26-tnf.vercel.app/blocks" style="color:#1a4fa0;">ad-26-tnf.vercel.app/blocks</a>');
    expect(html).not.toMatch(/<img|unsubscribe/i);
  });
});

describe("MIME", () => {
  const email = renderEvent(ctx("recruit_2026-10-07")).email;
  const decode = (msg: string, type: string) => {
    const part = msg.split(/--alt-seed\r\n/).find((p) => p.startsWith(`Content-Type: ${type}`));
    const body = part?.split("\r\n\r\n")[1]?.split("\r\n--")[0] ?? "";
    return Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
  };
  it("is multipart/alternative with a plain part that stands alone and an html part", () => {
    const msg = buildMime({ from: "A <a@tnf.test>", to: ["b@tnf.test"], email, boundary: "seed", date: new Date(0) }).toString("utf8");
    expect(msg).toContain('Content-Type: multipart/alternative; boundary="alt-seed"');
    expect(decode(msg, "text/plain")).toBe(email.text);
    expect(decode(msg, "text/html")).toBe(email.html);
    expect(msg).not.toMatch(/[^\r]\n/);
    expect(msg).not.toMatch(/^Bcc:/m);
  });
  it("wraps the alternative in multipart/mixed only when files ride along, and refuses a header line break", () => {
    const msg = buildMime({
      from: "a@tnf.test", to: ["a@tnf.test"], bcc: ["h@tnf.test"], email, boundary: "seed",
      attachments: [{ filename: "TNF_x.png", mimeType: "image/png", content: new Uint8Array([1, 2, 3]) }],
    }).toString("utf8");
    expect(msg).toContain('Content-Type: multipart/mixed; boundary="mix-seed"');
    expect(msg).toContain('Content-Disposition: attachment; filename="TNF_x.png"');
    expect(msg).toMatch(/^Bcc: h@tnf\.test\r$/m);
    expect(() => buildMime({ from: "a@tnf.test", to: ["a@tnf.test\r\nBcc: x@tnf.test"], email })).toThrow(/line break/);
  });
});
