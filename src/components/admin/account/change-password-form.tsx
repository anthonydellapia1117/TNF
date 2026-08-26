"use client";

// Change the admin password without touching the Supabase dashboard.
// The current password is verified by re-signing in with it (which also
// gives the session the recency Supabase wants before a credential
// change), then the password is updated on the signed-in user. Anon key
// only — no service role anywhere.

import { useState } from "react";
import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { changePasswordState, passwordRules } from "@/lib/password";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangePasswordForm({ email }: { email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const rules = passwordRules(next);
  const { canSubmit, blocker } = changePasswordState(current, next, confirm);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    setDone(false);
    const supabase = createSupabaseBrowserClient();

    // 1. Prove the current password — this is what stops someone using an
    //    unattended signed-in browser to lock the owner out.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (signInError) {
      setError("Current password is incorrect.");
      setBusy(false);
      return;
    }

    // 2. Set the new one.
    const { error: updateError } = await supabase.auth.updateUser({
      password: next,
    });
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }

    setCurrent("");
    setNext("");
    setConfirm("");
    setDone(true);
    setBusy(false);
    toast.success("Password changed. Use it the next time you sign in.");
  }

  return (
    <form onSubmit={submit} className="max-w-sm space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="current-password">Current password</Label>
        <Input
          id="current-password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          aria-describedby="password-rules"
          required
        />
        {/* Requirements live here, always visible, updating as you type —
            never a surprise after submit. */}
        <ul id="password-rules" className="space-y-1 pt-1">
          {rules.map((r) => (
            <li
              key={r.id}
              className={cn(
                "flex items-center gap-1.5 text-xs transition-colors duration-150",
                r.ok ? "text-emerald-400" : "text-muted-foreground",
              )}
            >
              {r.ok ? (
                <Check className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <Circle className="size-3.5 shrink-0" aria-hidden />
              )}
              {r.label}
              <span className="sr-only">{r.ok ? " — met" : " — not yet met"}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>

      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        {show ? (
          <EyeOff className="size-3.5" aria-hidden />
        ) : (
          <Eye className="size-3.5" aria-hidden />
        )}
        {show ? "Hide passwords" : "Show passwords"}
      </button>

      {blocker && <p className="text-sm text-halftime">{blocker}</p>}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="text-sm text-emerald-400" role="status">
          Password changed. Your session stays signed in — use the new
          password next time you log in.
        </p>
      )}

      <Button type="submit" disabled={!canSubmit || busy} className="w-full">
        {busy ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
