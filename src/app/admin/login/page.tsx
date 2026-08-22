import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Admin login" };

export default async function LoginPage() {
  const session = await getAdminSession();
  if (session) redirect("/admin");
  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-xl">Admin</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Sign in to run the pool. Players never need an account.
      </p>
      <LoginForm />
    </div>
  );
}
