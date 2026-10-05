import { cache } from "react";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { SupabaseNotConfiguredError } from "@/lib/supabase/env";
import type { User } from "@prisma/client";

// The *only* place application code asks "who is signed in" —
// CONVENTIONS.md #5. Everything else (pages, route handlers) calls one of
// these two, never `createClient().auth.getUser()` directly.
//
// Both are wrapped in React's `cache()`: the (app) layout calls
// getCurrentUser() to guard the whole group, and every page under it
// calls it again for its own data-fetching. Without caching, that's a
// second Supabase auth round-trip *and* a second Prisma upsert on every
// single page load — cache() dedupes repeat calls within one request so
// it actually only runs once.

/**
 * Returns the signed-in Prisma User row, or null if nobody's signed in.
 *
 * Upserts the matching row defensively: the real creation happens in
 * src/app/auth/callback/route.ts right after magic-link sign-in, so this
 * is a second line of defense for a session that predates that path (e.g.
 * a user created before the callback route existed), not the primary way
 * users get created.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    return null;
  }

  const { sub: id, email } = data.claims;

  if (!id || !email) {
    return null;
  }

  return db.user.upsert({
    where: { id },
    update: {},
    create: { id, email },
  });
});

export const getCurrentUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    return null;
  }

  return data.claims.sub;
});

/**
 * Route-handler variant of getCurrentUserId(): every mutating API route
 * needs the exact same three-way branch (not configured → 503, not
 * signed in → 401, else the id), so it lives here once instead of a
 * try/catch copy-pasted into every route.ts (CONVENTIONS.md #4 — shared
 * logic is a private/shared helper, not duplicated).
 *
 * Usage: `const auth = await getCurrentUserIdOrResponse(); if ("response"
 * in auth) return auth.response;`
 */
export async function getCurrentUserIdOrResponse(): Promise<
  { userId: string } | { response: NextResponse }
> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return { response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
    }
    return { userId };
  } catch (error) {
    if (error instanceof SupabaseNotConfiguredError) {
      return { response: NextResponse.json({ error: error.message }, { status: 503 }) };
    }
    throw error;
  }
}
