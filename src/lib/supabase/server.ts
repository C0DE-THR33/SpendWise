import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isSupabaseConfigured, SupabaseNotConfiguredError } from "./env";

/**
 * The one way server-side code (Server Components, Route Handlers, Server
 * Actions) gets a Supabase client. Cookie writes are wrapped in try/catch:
 * a Server Component can't set cookies, and that's expected — the session
 * gets refreshed by src/proxy.ts on the next request instead.
 */
export async function createClient() {
  if (!isSupabaseConfigured()) {
    throw new SupabaseNotConfiguredError();
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
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
            // Called from a Server Component — no-op, proxy.ts refreshes
            // the session on the next request instead.
          }
        },
      },
    },
  );
}
