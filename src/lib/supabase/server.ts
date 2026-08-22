import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";

/**
 * Anon-key client bound to the request's auth cookies. Use for all reads on
 * public routes and for every admin read and write — RLS applies in both
 * cases; the admin's own session is what unlocks the admin policies.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server components cannot set cookies; middleware handles refresh.
        }
      },
    },
  });
}

// There is deliberately NO service-role client. Admin reads and writes run
// as the signed-in admin (authenticated role) so RLS's is_admin() policies
// enforce authorization at the database, with no god-key in any env.
