import { createBrowserClient } from "@supabase/ssr";
import { isSupabaseConfigured, SupabaseNotConfiguredError } from "./env";

/**
 * The one way Client Components get a Supabase client (magic-link sign-in
 * forms, sign-out buttons). See lib/supabase/server.ts for the server-side
 * equivalent and SupabaseNotConfiguredError.
 */
export function createClient() {
  if (!isSupabaseConfigured()) {
    throw new SupabaseNotConfiguredError();
  }

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
