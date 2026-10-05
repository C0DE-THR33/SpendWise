"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SupabaseNotConfiguredError } from "@/lib/supabase/env";

type Status = "idle" | "sending" | "sent" | "error";

// useSearchParams() opts a client component out of static prerendering
// unless it's wrapped in Suspense — without this, `next build` fails
// prerendering this exact page.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/home";

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`,
        },
      });

      // The two ways this can end up stuck forever on "Sending…" if not
      // handled explicitly: the SDK returning `error` without throwing,
      // and createClient() throwing synchronously before the network call
      // even starts (CONVENTIONS.md #8 — this exact bug shipped once).
      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
        return;
      }

      setStatus("sent");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof SupabaseNotConfiguredError
          ? "SpendWise isn't configured yet — set up your .env file first."
          : "Something went wrong. Please try again.",
      );
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6">
      <div className="w-full max-w-sm rounded-card bg-surface shadow-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-fg">Sign in to SpendWise</h1>
        <p className="mt-1 text-sm text-fg-muted">
          We&apos;ll email you a magic link — no password needed.
        </p>

        {status === "sent" ? (
          <p className="mt-6 rounded-pill bg-success/10 px-4 py-3 text-sm text-success-fg">
            Check your inbox for a sign-in link.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-pill border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="rounded-pill bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </button>
            {status === "error" && errorMessage ? (
              <p className="text-sm text-danger-fg">{errorMessage}</p>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
