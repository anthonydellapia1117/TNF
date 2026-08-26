// Password rules for the admin account, mirrored from the Supabase project
// settings: at least 12 characters, containing both letters and digits, and
// not a repeat of the current password. Pure logic, and the SINGLE source
// the form's checklist and its submit gate both read — a rule can never be
// enforced somewhere the checklist doesn't show.

export interface PasswordRule {
  id: string;
  label: string;
  ok: boolean;
}

export const PASSWORD_MIN_LENGTH = 12;

/**
 * Every requirement with its live pass/fail state, in display order.
 * `current` is what the operator typed in the current-password field; until
 * it is filled the distinctness rule simply is not satisfiable yet, the same
 * way an empty new password does not satisfy the length rule.
 */
export function passwordRules(pw: string, current = ""): PasswordRule[] {
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
    {
      id: "distinct",
      label: "Different from your current password",
      ok: pw.length > 0 && current.length > 0 && pw !== current,
    },
  ];
}

export function passwordMeetsRules(pw: string, current = ""): boolean {
  return passwordRules(pw, current).every((r) => r.ok);
}

export interface ConfirmState {
  /** Every rule passes and the confirmation matches. */
  canSubmit: boolean;
  /** A cross-field message the checklist cannot express, or null. */
  blocker: string | null;
}

/**
 * Whether the form can submit, and why not. Every requirement lives in the
 * checklist above; the only message here is the confirmation mismatch, which
 * is about a different field rather than the password itself. Nothing
 * reports a problem before the relevant field has been typed in.
 */
export function changePasswordState(
  current: string,
  next: string,
  confirm: string,
): ConfirmState {
  if (!current) return { canSubmit: false, blocker: null };
  if (!passwordMeetsRules(next, current)) {
    return { canSubmit: false, blocker: null };
  }
  if (!confirm) return { canSubmit: false, blocker: null };
  if (confirm !== next) {
    return { canSubmit: false, blocker: "The two new passwords do not match." };
  }
  return { canSubmit: true, blocker: null };
}
