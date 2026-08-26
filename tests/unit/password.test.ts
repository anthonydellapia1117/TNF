import { describe, expect, it } from "vitest";
import {
  changePasswordState,
  PASSWORD_MIN_LENGTH,
  passwordMeetsRules,
  passwordRules,
} from "@/lib/password";

describe("admin password rules", () => {
  it("requires 12 characters, a letter, and a digit", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(passwordMeetsRules("short1a")).toBe(false); // too short
    expect(passwordMeetsRules("abcdefghijkl")).toBe(false); // no digit
    expect(passwordMeetsRules("123456789012")).toBe(false); // no letter
    expect(passwordMeetsRules("abcdefghijk1")).toBe(true); // exactly 12, both
  });

  it("reports each rule independently so the form can show them live", () => {
    const rules = passwordRules("abcdefgh"); // 8 letters, no digit
    expect(rules.map((r) => [r.id, r.ok])).toEqual([
      ["length", false],
      ["letter", true],
      ["digit", false],
    ]);
  });

  it("counts symbols toward length but never instead of a letter or digit", () => {
    expect(passwordMeetsRules("!@#$%^&*()!@")).toBe(false);
    expect(passwordMeetsRules("!@#$%^&*()a1")).toBe(true);
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

  it("blocks a no-op change", () => {
    const s = changePasswordState(GOOD, GOOD, GOOD);
    expect(s.canSubmit).toBe(false);
    expect(s.blocker).toMatch(/different/i);
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
