import { describe, expect, it } from "vitest";
import {
  changePasswordState,
  PASSWORD_MIN_LENGTH,
  passwordMeetsRules,
  passwordRules,
} from "@/lib/password";

describe("admin password rules", () => {
  const OLD = "the-old-password1";

  it("requires 12 characters, a letter, and a digit", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(passwordMeetsRules("short1a", OLD)).toBe(false); // too short
    expect(passwordMeetsRules("abcdefghijkl", OLD)).toBe(false); // no digit
    expect(passwordMeetsRules("123456789012", OLD)).toBe(false); // no letter
    expect(passwordMeetsRules("abcdefghijk1", OLD)).toBe(true); // 12, both
  });

  it("shows distinctness AS A CHECKLIST RULE, not a post-submit surprise", () => {
    const ids = passwordRules("abcdefghijk1", OLD).map((r) => r.id);
    expect(ids).toContain("distinct");
    const distinct = (pw: string, cur: string) =>
      passwordRules(pw, cur).find((r) => r.id === "distinct")!;
    expect(distinct(OLD, OLD).ok).toBe(false); // same as current
    expect(distinct("abcdefghijk1", OLD).ok).toBe(true);
    expect(distinct("abcdefghijk1", "").ok).toBe(false); // current not typed yet
    expect(distinct("", OLD).ok).toBe(false); // new not typed yet
    expect(distinct(OLD, OLD).label).toMatch(/different from your current/i);
  });

  it("the checklist and the submit gate read the same rules", () => {
    // Anything the gate blocks on is visible as an unmet checklist row.
    const cases: [string, string][] = [
      [OLD, OLD], // same
      ["short1", OLD], // too short
      ["abcdefghijkl", OLD], // no digit
    ];
    for (const [next, cur] of cases) {
      const gateBlocks = !changePasswordState(cur, next, next).canSubmit;
      const someRuleUnmet = passwordRules(next, cur).some((r) => !r.ok);
      expect(gateBlocks).toBe(true);
      expect(someRuleUnmet).toBe(true);
    }
  });

  it("reports each rule independently so the form can show them live", () => {
    const rules = passwordRules("abcdefgh", OLD); // 8 letters, no digit
    expect(rules.map((r) => [r.id, r.ok])).toEqual([
      ["length", false],
      ["letter", true],
      ["digit", false],
      ["distinct", true],
    ]);
  });

  it("counts symbols toward length but never instead of a letter or digit", () => {
    expect(passwordMeetsRules("!@#$%^&*()!@", OLD)).toBe(false);
    expect(passwordMeetsRules("!@#$%^&*()a1", OLD)).toBe(true);
  });
});

describe("change-password form state", () => {
  const GOOD = "brandnewpass1";

  it("stays quiet until a field has actually been typed in", () => {
    expect(changePasswordState("", "", "")).toEqual({
      canSubmit: false,
      blocker: null,
    });
    // New password half-typed: not submittable, but not scolding either.
    expect(changePasswordState("oldpassword1", "brand", "")).toEqual({
      canSubmit: false,
      blocker: null,
    });
  });

  it("blocks a no-op change (surfaced by the distinct checklist rule)", () => {
    const s = changePasswordState(GOOD, GOOD, GOOD);
    expect(s.canSubmit).toBe(false);
    const distinct = passwordRules(GOOD, GOOD).find((r) => r.id === "distinct");
    expect(distinct?.ok).toBe(false);
  });

  it("blocks a mismatched confirmation", () => {
    const s = changePasswordState("oldpassword1", GOOD, "brandnewpass2");
    expect(s.canSubmit).toBe(false);
    expect(s.blocker).toMatch(/do not match/i);
  });

  it("submits only when every rule passes and the confirmation matches", () => {
    expect(changePasswordState("oldpassword1", GOOD, GOOD)).toEqual({
      canSubmit: true,
      blocker: null,
    });
  });

  it("never submits a new password that fails the rules", () => {
    expect(changePasswordState("oldpassword1", "weak", "weak").canSubmit).toBe(
      false,
    );
  });
});
