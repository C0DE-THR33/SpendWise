// Shared by client.ts, server.ts and proxy.ts. Lives in its own file
// because server.ts pulls in `next/headers`, which can't be bundled into
// Client Component code or run in src/proxy.ts.

/**
 * Thrown by every Supabase client factory when the required env vars
 * aren't set. Callers (pages, route handlers) catch this and render a
 * "not configured yet" state instead of letting a raw error 500 the page —
 * see CONVENTIONS.md #5. This is what keeps a freshly cloned repo demoable
 * before `.env` is filled in.
 */
export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example).",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
