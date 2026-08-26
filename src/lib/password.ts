// Password rules for the admin account, mirrored from the Supabase project
// settings: at least 12 characters, containing both letters and digits.
// Pure logic so the form can show every requirement live instead of failing
// after submit, and so the rules are unit-testable.

export interface PasswordRule {
  id: string;
  label: string;
  ok: boolean;
}

export const PASSWORD_MIN_LENGTH = 12;

/** Every rule with its live pass/fail state, in display order. */
export function passwordRules(pw: string): PasswordRule[] {
  return [
    {
      id: "length",
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      ok: pw.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: "letter",
      label: "Contains a letter",
      ok: /\p{L}/u.test(pw),
    },
    {
      id: "digit",
      label: "Contains a digit",
      ok: /\d/.test(pw),
    },
  ];
}

export function passwordMeetsRules(pw: string): boolean {
  return passwordRules(pw).every((r) => r.ok);
}

export interface ConfirmState {
  /** Every rule passes, the confirmation matches, and it is a real change. */
  canSubmit: boolean;
  /** The single blocking message to show, or null when good to go. */
  blocker: string | null;
}

/**
 * Whether the form can submit, and why not. Nothing here reports a problem
 * until the relevant field has been typed in — requirements are guidance,
 * not accusations.
 */
export function changePasswordState(
  current: string,
  next: string,
  confirm: string,
): ConfirmState {
  if (!current) return { canSubmit: false, blocker: null };
  if (!passwordMeetsRules(next)) return { canSubmit: false, blocker: null };
  if (next === current) {
    return {
      canSubmit: false,
      blocker: "New password must be different from your current one.",
    };
  }
  if (!confirm) return { canSubmit: false, blocker: null };
  if (confirm !== next) {
    return { canSubmit: false, blocker: "The two new passwords do not match." };
  }
  return { canSubmit: true, blocker: null };
}
