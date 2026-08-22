// Runtime configuration. Env vars win when set (Vercel / local); the
// committed fallbacks keep every environment working without dashboard
// setup. This is safe by design: the anon key ships to every browser
// anyway and RLS is the security boundary — there is NO service-role key
// anywhere in this codebase (spec section 1).

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://bqisojzdwodwaznzwega.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxaXNvanpkd29kd2F6bnp3ZWdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MTQ2ODEsImV4cCI6MjEwMjk5MDY4MX0.XN9lD1UFUnLThMlPaCbInib9tBbk2NTSc5cgl0MShLs";

export const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL ?? "anthonydellapia@gmail.com";
