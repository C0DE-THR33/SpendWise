import { createHmac, timingSafeEqual } from "node:crypto";
import {
  parseConsentAccounts,
  parseDataSession,
  type ParsedConsentAccount,
  type ParsedDataSession,
} from "@/lib/setu-parse";

// Client for Setu's Account Aggregator gateway, pointed at the sandbox by
// default (https://docs.setu.co/data/account-aggregator). Every call needs
// sandbox credentials this repo does not ship — see .env.example and
// README's "Connecting the Setu AA sandbox". Mirrors the Supabase pattern
// (CONVENTIONS.md #5): missing config throws SetuNotConfiguredError, which
// callers catch to degrade gracefully instead of 500ing the connect-bank
// flow.
//
// Shapes here are written against Setu's current docs, not from memory —
// the previous version of this file guessed, and guessed wrong in three
// places (CONVENTIONS.md #8):
//   - the consent endpoint takes `vua` + `dataRange` and returns
//     `{ id, url, status, detail }`, not `{ consentId, consentHandle,
//     redirectUrl }`;
//   - fetching data is two calls, POST /sessions then GET /sessions/:id,
//     not a single read of a session id that arrives from nowhere;
//   - FI data comes back nested per FIP per account, not as a flat
//     `transactions` array.

export class SetuNotConfiguredError extends Error {
  constructor() {
    super(
      "Setu AA is not configured: set SETU_CLIENT_ID, SETU_CLIENT_SECRET " +
        "and SETU_PRODUCT_INSTANCE_ID (see .env.example).",
    );
    this.name = "SetuNotConfiguredError";
  }
}

/** A non-2xx from Setu. Carries the body, which is where the real reason is. */
export class SetuApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    endpoint: string,
  ) {
    super(`Setu ${endpoint} failed: ${status} ${body.slice(0, 500)}`);
    this.name = "SetuApiError";
  }
}

export function isSetuConfigured(): boolean {
  return Boolean(
    process.env.SETU_CLIENT_ID &&
      process.env.SETU_CLIENT_SECRET &&
      process.env.SETU_PRODUCT_INSTANCE_ID,
  );
}

/**
 * Sandbox and production differ only by host, so this is an env var rather
 * than a constant — pointing a deploy at production is a config change, not
 * a code change.
 */
function baseUrl(): string {
  return (process.env.SETU_AA_BASE_URL ?? "https://fiu-sandbox.setu.co").replace(/\/+$/, "");
}

/**
 * The gateway's API version, and a trap worth knowing about: Setu's docs
 * document these endpoints as `POST /consents` against the sandbox base
 * URL, but the live sandbox only serves them under `/v2`. The unversioned
 * path is still routed — to something that rejects perfectly valid
 * credentials with `401 INVALID_CREDENTIALS`, so the symptom points at the
 * keys rather than the URL. Found by probing both paths with the same
 * headers: `/consents` 401s, `/v2/consents` returns 201.
 */
const API_VERSION = "/v2";

/**
 * Turns a mobile number into the `vua` the consent endpoint wants. The
 * gateway accepts either `9999999999` or `9999999999@<aa>`, and an empty
 * `SETU_AA_HANDLE` sends the bare form.
 *
 * Empty is the right default, but not because it selects an AA — it does
 * not. Which account aggregator a consent is routed to is fixed by the
 * product instance on the Bridge. Sending the bare number simply avoids
 * naming an AA this FIU is not onboarded with, which is the difference
 * between a consent and a 400. Probed against the live sandbox on one set
 * of credentials:
 *
 *   9999999999                201 in 0.9s  — routed to whatever the Bridge says
 *   9999999999@onemoney       201          — same AA, named explicitly
 *   9999999999@setu           500          — recognised, AA unreachable
 *   9999999999@finvu          400          — "fair use rules template id: null"
 *   9999999999@anumati        400          — "not as per Fair Usage Policy"
 *   9999999999@nonsense       400          — "entity handle not supported"
 *
 * The finvu/anumati 400s are the FIU not being registered with those AAs,
 * not a bad request — a null fair-use template means no policy exists for
 * this FIU there, so the permitted frequency is zero.
 *
 * Approval is a separate matter from routing, and it depends on the number,
 * not on this variable. The sandbox product routes to Onemoney, whose
 * approval screen refuses `9999999999` (even with the documented `123456`,
 * as "Incorrect OTP! Please check.") but accepts a real mobile number whose
 * OTP the tester actually receives — no whitelisting request needed.
 * Verified 2026-10-03 with prototypes/setu-aa: consent ACTIVE, data session
 * delivered.
 */
export function toVua(mobileNumber: string): string {
  const digits = mobileNumber.replace(/\D/g, "").slice(-10);
  const handle = process.env.SETU_AA_HANDLE?.trim().replace(/^@/, "");
  return handle ? `${digits}@${handle}` : digits;
}

export function isValidMobileNumber(mobileNumber: string): boolean {
  return /^[6-9]\d{9}$/.test(mobileNumber.replace(/\D/g, "").slice(-10));
}

// Setu's sandbox authenticates FIU calls with the three credentials the
// Bridge hands out in "Step 2 — Test your product". (Products issued OAuth
// keys instead send `Authorization: Bearer <token>` alongside the same
// x-product-instance-id; if that is what your Bridge project shows, this is
// the one function that needs to change.)
function authHeaders(): Record<string, string> {
  if (!isSetuConfigured()) {
    throw new SetuNotConfiguredError();
  }
  return {
    "Content-Type": "application/json",
    "x-client-id": process.env.SETU_CLIENT_ID!,
    "x-client-secret": process.env.SETU_CLIENT_SECRET!,
    "x-product-instance-id": process.env.SETU_PRODUCT_INSTANCE_ID!,
  };
}

/**
 * Raw request, exported for scripts/setu-smoke.ts so it can dump payloads
 * exactly as Setu sends them. Application code should use the typed
 * functions below — the point of the parsers is that no route handler ever
 * touches an unnormalised FIP payload.
 */
export async function setuRequest(path: string, init?: RequestInit): Promise<unknown> {
  return setuFetch(path, init);
}

async function setuFetch(path: string, init?: RequestInit): Promise<unknown> {
  const headers = authHeaders();
  const response = await fetch(`${baseUrl()}${API_VERSION}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new SetuApiError(
      response.status,
      await response.text(),
      `${init?.method ?? "GET"} ${path}`,
    );
  }

  return response.json();
}

// --- Consent ---------------------------------------------------------------

export interface DataRange {
  from: Date;
  to: Date;
}

export interface ConsentRequestResult {
  /** Setu's consent id — the value echoed back on the redirect and webhooks. */
  consentId: string;
  /** Setu-hosted approval screens; the browser is sent here next. */
  url: string;
  status: string;
}

/**
 * Raises a consent request. Purpose, fiTypes, consent mode and the rest of
 * the consent object are configured once on the Bridge product, so the
 * per-request body is only who, how long, over what range, and where to
 * come back to.
 */
export async function createConsentRequest(params: {
  vua: string;
  redirectUrl: string;
  dataRange: DataRange;
  durationMonths?: number;
}): Promise<ConsentRequestResult> {
  // No `context` here, and no way to add one: the gateway validates context
  // keys against a fixed vocabulary (accounttype, fipId, consentReviewAt,
  // purposeDescription, purposeCode, alternateNumber, accountSelectionMode,
  // transactionType, excludeFipIds, excludeFipIdsByFiType) and rejects
  // anything else with a 400. So a consent carries no application identity
  // whatsoever, and the AaConsent row is not merely the trustworthy way to
  // map a consent id to a user — it is the only way (CONVENTIONS.md #4c).
  const data = (await setuFetch("/consents", {
    method: "POST",
    body: JSON.stringify({
      consentDuration: { unit: "MONTH", value: String(params.durationMonths ?? 12) },
      vua: params.vua,
      dataRange: {
        from: params.dataRange.from.toISOString(),
        to: params.dataRange.to.toISOString(),
      },
      redirectUrl: params.redirectUrl,
    }),
  })) as { id?: string; url?: string; status?: string };

  if (!data.id || !data.url) {
    throw new Error("Setu consent response was missing id or url");
  }

  return { consentId: data.id, url: data.url, status: data.status ?? "PENDING" };
}

export type SetuConsentStatus =
  | "PENDING"
  | "ACTIVE"
  | "REJECTED"
  | "PAUSED"
  | "REVOKED"
  | "EXPIRED"
  | "FAILED";

export interface SetuConsent {
  consentId: string;
  status: SetuConsentStatus;
  consentExpiry: Date | null;
  /** Populated once the user has approved and picked accounts. */
  accounts: ParsedConsentAccount[];
}

/**
 * Reads a consent back. `expanded=true` is what makes the linked accounts
 * come along — without it there is no way to learn which accounts the user
 * actually picked, and therefore nothing to create LinkedAccount rows from.
 */
export async function getConsent(consentId: string): Promise<SetuConsent> {
  const data = (await setuFetch(`/consents/${encodeURIComponent(consentId)}?expanded=true`)) as {
    id?: string;
    status?: string;
    detail?: { consentExpiry?: string };
  };

  const expiry = data.detail?.consentExpiry ? new Date(data.detail.consentExpiry) : null;

  return {
    consentId: data.id ?? consentId,
    status: (data.status ?? "PENDING") as SetuConsentStatus,
    consentExpiry: expiry && !Number.isNaN(expiry.getTime()) ? expiry : null,
    // The whole payload, not `detail`: the linked accounts come back in a
    // top-level `accountsLinked` array, which is not where the docs' consent
    // object suggested looking. The parser accepts both.
    accounts: parseConsentAccounts(data),
  };
}

// --- Data sessions ---------------------------------------------------------

/**
 * Asks the AA to go fetch statement data for an active consent. The range
 * must sit inside the consent's own range or Setu rejects it — which is why
 * AaConsent stores the range it was raised with.
 */
export async function createDataSession(params: {
  consentId: string;
  dataRange: DataRange;
}): Promise<{ dataSessionId: string; status: string }> {
  const data = (await setuFetch("/sessions", {
    method: "POST",
    body: JSON.stringify({
      consentId: params.consentId,
      dataRange: {
        from: params.dataRange.from.toISOString(),
        to: params.dataRange.to.toISOString(),
      },
      format: "json",
    }),
  })) as { id?: string; status?: string };

  if (!data.id) {
    throw new Error("Setu data session response was missing id");
  }

  return { dataSessionId: data.id, status: data.status ?? "PENDING" };
}

/**
 * Reads a data session. A session is PENDING until the FIPs deliver, so a
 * caller either polls this or waits for the SESSION_STATUS_UPDATE webhook;
 * PARTIAL means some accounts are ready and others failed, and is worth
 * ingesting rather than discarding.
 */
export async function getDataSession(dataSessionId: string): Promise<ParsedDataSession> {
  try {
    return parseDataSession(await setuFetch(`/sessions/${encodeURIComponent(dataSessionId)}`));
  } catch (error) {
    // The live sandbox answers a read before the FIPs have delivered with a
    // 400 ("Data is not yet ready for fetch, retry after FI notification")
    // rather than a PENDING session. That is the normal first poll of every
    // connect, not a failure, so it is reported the way the docs describe.
    if (
      error instanceof SetuApiError &&
      error.status === 400 &&
      /not yet ready/i.test(error.body)
    ) {
      return { status: "PENDING", accounts: [] };
    }
    throw error;
  }
}

// --- Webhooks --------------------------------------------------------------

export function isWebhookSecretConfigured(): boolean {
  return Boolean(process.env.SETU_WEBHOOK_SECRET);
}

/**
 * HMAC-SHA256 over the raw body, keyed with SETU_WEBHOOK_SECRET — the
 * shared secret set on the Bridge notification endpoint.
 *
 * Setu's docs describe the notification payloads but not a signing scheme,
 * so this is only as good as what the Bridge is actually configured to
 * send. That is exactly why the webhook route never trusts a payload's
 * *contents* even when this passes: it re-reads the consent or session from
 * Setu's API with our own credentials and acts on that instead. A missing
 * secret therefore degrades to "unauthenticated hint" rather than to
 * "reject everything" — which is what the previous stub did by returning
 * false unconditionally, silently discarding every real notification.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.SETU_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const provided = Buffer.from(signature.replace(/^sha256=/i, "").trim(), "utf8");
  const expected = Buffer.from(
    createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"),
    "utf8",
  );

  // Length check first: timingSafeEqual throws on a length mismatch rather
  // than returning false.
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
