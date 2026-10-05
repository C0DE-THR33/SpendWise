import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth";
import { SupabaseNotConfiguredError } from "@/lib/supabase/env";
import { NotConfigured } from "@/components/NotConfigured";

// Root route: just a traffic director. Signed in → /home. Not signed in →
// /login. src/proxy.ts already guards every other route, but this one is
// public, so it has to check for itself.
export default async function RootPage() {
  let userId: string | null;

  try {
    userId = await getCurrentUserId();
  } catch (error) {
    if (error instanceof SupabaseNotConfiguredError) {
      return <NotConfigured />;
    }
    throw error;
  }

  redirect(userId ? "/home" : "/login");
}
