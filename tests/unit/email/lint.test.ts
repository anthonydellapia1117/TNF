// The render-lint: every event, rendered from a fixture shaped like the
// database, must pass every rule on the OUTPUT. A rule broken by new wording
// or new data fails here before it can reach a mailbox.

import { describe, expect, it } from "vitest";
import { lintEmail, renderEvent } from "@/lib/email";
import { FAMILIES } from "@/lib/email/registry";
import { MAX_LINE } from "@/lib/email/wrap";
import { ALL_EVENTS } from "./fixtures";

describe("render-lint over every event", () => {
  it("covers every event family", () => {
    const covered = new Set(ALL_EVENTS.map(([c]) => FAMILIES.find((f) => f.match.test(c.event_key))?.name));
    expect([...covered].sort()).toEqual(FAMILIES.map((f) => f.name).sort());
  });

  for (const [c, args] of ALL_EVENTS) {
    it(`${c.event_key} renders clean`, () => {
      const r = renderEvent(c, args);
      expect(r.problems).toEqual([]);
      for (const part of [r.email.subject, r.email.text, r.email.html]) {
        expect(part).not.toMatch(/[–—]/);
        expect(part).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(part).not.toContain("$");
      }
      for (const line of r.email.text.split("\n")) expect(line.length).toBeLessThan(70);
    });
  }
});

describe("the lint itself", () => {
  const ok = { subject: "S", text: "fine\n", html: "<p>fine</p>" };
  it("passes a clean email", () => expect(lintEmail(ok)).toEqual([]));
  it("catches a dollar sign, a dash, an emoji, a long line, a relative date, an image", () => {
    expect(lintEmail({ ...ok, text: "$500\n" })).toContain("text: a dollar sign");
    expect(lintEmail({ ...ok, subject: "a — b" })).toContain("subject: an em or en dash");
    expect(lintEmail({ ...ok, html: "<p>–</p>" })).toContain("html: an em or en dash");
    expect(lintEmail({ ...ok, text: "hi \u{1F3C8}\n" })).toContain("text: an emoji");
    expect(lintEmail({ ...ok, text: `${"x".repeat(MAX_LINE + 1)}\n` })[0]).toMatch(/text line 1: 70 characters/);
    expect(lintEmail({ ...ok, text: "see you tomorrow\n" })[0]).toMatch(/relative date/);
    expect(lintEmail({ ...ok, html: '<img src="x">' })).toContain("html: an image");
    expect(lintEmail({ ...ok, text: "Done. Let me know if that works.\n" })).toContain('text: filler ("Let me know if")');
    expect(lintEmail({ ...ok, text: "Hope this helps\n" })[0]).toMatch(/filler/);
  });
});
