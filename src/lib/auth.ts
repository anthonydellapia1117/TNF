import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ADMIN_EMAIL } from "@/lib/env";

export interface AdminSession {
  email: string;
  actor: string;
}

/** Session if the request is the admin; null otherwise. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return null;
  }
  return { email: user.email, actor: user.email };
}

/** Gate for admin pages: redirects to the login screen when not the admin. */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}
