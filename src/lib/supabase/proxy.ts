import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "./env";

/**
 * Builds a Supabase client bound to one request/response pair, and the
 * NextResponse that carries any refreshed session cookie. src/proxy.ts
 * calls this on every request to a protected path.
 *
 * Returns `null` when Supabase isn't configured — proxy.ts treats that as
 * "can't check auth, don't redirect" rather than crashing every request.
 */
export function createProxyClient(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  return { supabase, getResponse: () => response };
}
