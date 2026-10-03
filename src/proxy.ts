import { NextResponse, type NextRequest } from "next/server";
import { createProxyClient } from "@/lib/supabase/proxy";

// Next.js 16 renamed `middleware.ts` to `proxy.ts` and moved its expected
// location to alongside app/ (src/proxy.ts) rather than the project root —
// see CONVENTIONS.md #8. This file's one job: refresh the Supabase session
// cookie on every request, and redirect anything not on PUBLIC_PATHS away
// to /login when there's no signed-in user.
//
// Uses getClaims(), never getSession() — getClaims() verifies the JWT
// signature; getSession() trusts whatever the request's cookies claim,
// which is not a safe basis for a security decision (CONVENTIONS.md #5).

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/api/aa/webhook", // called by Setu's servers, not a signed-in browser
];

function isPublicPath(pathname: string): boolean {
  // The fixture-rendered design harness holds no user data and 404s in
  // production (app/design-preview/page.tsx). Sending it to /login would
  // defeat the point of a page that exists precisely so the UI can be
  // looked at without a session.
  if (process.env.NODE_ENV !== "production" && pathname === "/design-preview") {
    return true;
  }

  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function proxy(request: NextRequest) {
  const proxyClient = createProxyClient(request);

  // Supabase isn't configured — let the request through rather than
  // redirect-looping every page to a /login that can't work either
  // (CONVENTIONS.md #5, "degrade gracefully").
  if (!proxyClient) {
    return NextResponse.next();
  }

  const { supabase, getResponse } = proxyClient;
  const { pathname } = request.nextUrl;

  const { data, error } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims) && !error;

  if (!isAuthenticated && !isPublicPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return getResponse();
}

export const config = {
  matcher: [
    /*
     * Match every path except:
     * - _next/static, _next/image (Next's own assets)
     * - favicon.ico
     * - common static file extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
