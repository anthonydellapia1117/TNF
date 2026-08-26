import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/admin/account/change-password-form";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireAdmin();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl">Account</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Signed in as{" "}
          <span className="text-foreground">{session.email}</span>. Change
          your password here — no Supabase dashboard needed.
        </p>
      </div>
      <ChangePasswordForm email={session.email} />
    </div>
  );
}
