// A local stand-in for Setu's AA gateway, so the whole bank-connect flow —
// raise a consent, approve it, link accounts, fetch and categorize twelve
// months of statements — can be run end to end without Setu.
//
// Why this exists: every real sandbox approval needs a phone to receive an
// OTP on (Onemoney refuses the dummy 9999999999 — README step 1), and Setu
// can only deliver webhooks to a public URL. This approves with a click and
// posts webhooks to localhost, so the flow can be rerun in seconds.
//
// This serves the same four endpoints under the same /v2 prefix, so the app
// reaches it through the ordinary client with the ordinary credentials
// check. Pointing at it is a one-line env change, and no code path is
// special-cased for it:
//
//   SETU_AA_BASE_URL=http://localhost:4100
//
// It stands in for the *aggregator*, not for lib/setu.ts. Every payload is
// shaped like a relayed FIP response, including the parts that make real
// ones annoying — XML-derived casing (`fipID`, `FIstatus`,
// `maskedAccNumber`), a single transaction arriving as a bare object rather
// than a one-element array, and no `summary` block, so the balance has to be
// read off the transactions — as captured from the live sandbox on
// 2026-10-03 (prototypes/setu-aa). Those are precisely the cases
// setu-parse.ts exists to absorb, so a mock that sent tidy JSON would prove
// nothing (CONVENTIONS.md #8).
//
// Usage:
//   npm run mock:aa                                      serve on :4100
//   npm run mock:aa -- --port 4200
//   npm run mock:aa -- --webhook http://localhost:3000/api/aa/webhook
//   npm run mock:aa -- --pending-reads 3                 3 polls before ready
//   npm run mock:aa -- --partial                         one FIP TIMEOUTs

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

// --- options ---------------------------------------------------------------

const argv = process.argv.slice(2);

function option(name: string, fallback: string): string {
  const index = argv.indexOf(`--${name}`);
  return index !== -1 && argv[index + 1] ? argv[index + 1] : fallback;
}

const PORT = Number(option("port", "4100"));
const WEBHOOK_URL = option("webhook", "");
/** How many reads of a session return PENDING before it has data. */
const PENDING_READS = Number(option("pending-reads", "1"));
const PARTIAL = argv.includes("--partial");

// --- the fake bank ---------------------------------------------------------

interface MockAccount {
  fipId: string;
  fipName: string;
  linkRefNumber: string;
  maskedAccNumber: string;
  /** The fine-grained type, which only ever appears in the FI summary. */
  summaryType: "SAVINGS" | "CURRENT";
  openingBalance: number;
  /** Seed for this account's statement, so the two banks differ. */
  seed: number;
}

const ACCOUNTS: MockAccount[] = [
  {
    fipId: "HDFC-FIP",
    fipName: "HDFC Bank",
    linkRefNumber: "hdfc-link-ref-0001",
    maskedAccNumber: "XXXXXX4821",
    summaryType: "SAVINGS",
    openingBalance: 82_000,
    seed: 0x5e6d21,
  },
  {
    fipId: "AXIS-FIP",
    fipName: "Axis Bank",
    linkRefNumber: "axis-link-ref-0002",
    maskedAccNumber: "XXXXXX9134",
    summaryType: "CURRENT",
    openingBalance: 31_500,
    seed: 0x1f77b4,
  },
];

/**
 * Deterministic PRNG (mulberry32). Statement data has to be identical across
 * runs, or the idempotency check — sync twice, expect the row count not to
 * move — would be testing this generator rather than the upsert.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Narrations in the shape banks actually send: a UPI/POS/ACH prefix, the
// merchant buried in the middle, punctuation differing per bank. These are
// what exercise lib/categorize.ts's word-boundary matching — a clean
// merchant column would make any categorizer look correct. Note METRO CARD
// RECHARGE, which is the brand-beats-keyword case that tier ordering exists
// for, and CHOCOLATE, which must not match the OLA brand rule.
const DEBITS: ReadonlyArray<readonly [string, number, number, string]> = [
  ["UPI/DR/%REF%/SWIGGY/YESB/swiggy@ybl", 180, 720, "UPI"],
  ["UPI/DR/%REF%/ZOMATO/HDFC/zomato@paytm", 220, 890, "UPI"],
  ["UPI/DR/%REF%/BLINKIT/ICIC/blinkit@okaxis", 240, 1_450, "UPI"],
  ["POS 4321XXXXXXXX1234 UBER INDIA SYSTEMS", 110, 640, "CARD"],
  ["UPI/DR/%REF%/RAPIDO/AXIS/rapido@ybl", 60, 260, "UPI"],
  ["POS 4321XXXXXXXX1234 AMAZON SELLER SERVICES", 399, 4_200, "CARD"],
  ["UPI/DR/%REF%/MYNTRA DESIGNS/HDFC", 700, 3_100, "UPI"],
  ["ACH DR- NETFLIX ENTERTAINMENT SVCS", 199, 649, "ACH"],
  ["ACH DR- SPOTIFY INDIA", 119, 179, "ACH"],
  ["BILLPAY AIRTEL POSTPAID 9876543210", 399, 1_099, "NETBANKING"],
  ["BILLPAY BESCOM ELECTRICITY BNG", 780, 2_900, "NETBANKING"],
  ["UPI/DR/%REF%/DMART AVENUE SUPERMARTS/SBIN", 900, 4_600, "UPI"],
  ["POS 4321XXXXXXXX1234 STARBUCKS COFFEE", 230, 620, "CARD"],
  ["UPI/DR/%REF%/METRO CARD RECHARGE BMRCL", 100, 500, "UPI"],
  ["POS 4321XXXXXXXX1234 HPCL FUEL STATION", 1_000, 3_400, "CARD"],
  ["UPI/DR/%REF%/APOLLO PHARMACY/ICIC", 180, 1_600, "UPI"],
  ["UPI/DR/%REF%/CULT FIT/HDFC", 1_200, 2_400, "UPI"],
  ["POS 4321XXXXXXXX1234 PVR CINEMAS", 350, 1_300, "CARD"],
  ["POS 4321XXXXXXXX1234 CHOCOLATE BOUTIQUE", 250, 900, "CARD"],
];

function two(value: number): string {
  return value.toFixed(2);
}

interface MockTransaction {
  txnId: string;
  amount: string;
  type: "DEBIT" | "CREDIT";
  narration: string;
  mode: string;
  transactionTimestamp: string;
  valueDate: string;
  currentBalance: string;
}

/**
 * Twelve months of statement lines: a salary credit and a rent debit on
 * fixed days so the monthly views have a spine, plus a plausible scatter of
 * everyday spending. Seeded per account, so the two banks differ from each
 * other and neither differs between runs.
 */
function buildTransactions(account: MockAccount): MockTransaction[] {
  const random = rng(account.seed);
  const transactions: MockTransaction[] = [];
  let balance = account.openingBalance;

  const now = new Date();
  // Tuned so the closing balance drifts up slowly rather than ballooning:
  // pay minus rent minus a month of spending leaves roughly 8-12k. A salary
  // that comfortably outruns spending would end the year at several lakh and
  // make every chart in the app look like a savings account nobody touches.
  const salary = account.summaryType === "SAVINGS" ? 62_000 : 58_000;

  for (let monthsAgo = 11; monthsAgo >= 0; monthsAgo -= 1) {
    const month = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

    const push = (
      day: number,
      type: "DEBIT" | "CREDIT",
      amount: number,
      narration: string,
      mode: string,
    ) => {
      const date = new Date(
        month.getFullYear(),
        month.getMonth(),
        Math.min(day, daysInMonth),
        9 + Math.floor(random() * 11),
        Math.floor(random() * 60),
      );
      // The current month is only partly over; inventing next week's coffee
      // would make "this month vs last" nonsense.
      if (date > now) return;

      balance += type === "CREDIT" ? amount : -amount;
      transactions.push({
        txnId: `TXN${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
          transactions.length,
        ).padStart(4, "0")}${account.linkRefNumber.slice(-4)}`,
        amount: two(amount),
        type,
        narration: narration.replace("%REF%", String(400_000_000 + Math.floor(random() * 99_999_999))),
        mode,
        transactionTimestamp: date.toISOString(),
        valueDate: date.toISOString().slice(0, 10),
        currentBalance: two(balance),
      });
    };

    push(1, "CREDIT", salary + Math.floor(random() * 4_000), "NEFT CR-SALARY ACME TECHNOLOGIES PVT LTD", "NEFT");
    push(3, "DEBIT", account.summaryType === "SAVINGS" ? 28_000 : 22_000, "ACH DR- RENT PAYMENT LANDLORD", "ACH");

    const spends = 14 + Math.floor(random() * 8);
    for (let i = 0; i < spends; i += 1) {
      const [narration, min, max, mode] = DEBITS[Math.floor(random() * DEBITS.length)];
      push(2 + Math.floor(random() * 27), "DEBIT", Math.round(min + random() * (max - min)), narration, mode);
    }
  }

  return transactions.sort(
    (a, b) => new Date(a.transactionTimestamp).getTime() - new Date(b.transactionTimestamp).getTime(),
  );
}

// --- state -----------------------------------------------------------------

interface Consent {
  id: string;
  status: "PENDING" | "ACTIVE" | "REJECTED";
  redirectUrl: string;
  vua: string;
  /** linkRefNumbers the user ticked on the approval screen. */
  linked: string[];
  expiry: string;
}

interface Session {
  id: string;
  consentId: string;
  reads: number;
}

const consents = new Map<string, Consent>();
const sessions = new Map<string, Session>();

// --- helpers ---------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function html(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

/**
 * JSON for the API calls, form encoding for the approval screen. The form
 * half keeps every value for a repeated key — the account checkboxes all
 * post as `link`, and `Object.fromEntries` over a URLSearchParams would
 * silently keep only the last one, linking one account no matter how many
 * were ticked.
 */
async function readBody(req: IncomingMessage): Promise<Record<string, string[]>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};

  const out: Record<string, string[]> = {};
  const add = (key: string, value: string) => {
    (out[key] ??= []).push(value);
  };

  try {
    for (const [key, value] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) {
      add(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  } catch {
    for (const [key, value] of new URLSearchParams(raw)) add(key, value);
  }
  return out;
}

function one(body: Record<string, string[]>, key: string): string {
  return body[key]?.[0] ?? "";
}

/**
 * Fire-and-forget, exactly like the real gateway: a notification is a hint
 * that something changed, and the app is expected to re-read the truth from
 * the API rather than trust the body. Failures are logged, never retried —
 * blocking or throwing here would have the mock asserting delivery
 * guarantees the real gateway does not make.
 */
function notify(type: string, payload: Record<string, unknown>) {
  if (!WEBHOOK_URL) return;
  void fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, ...payload }),
  })
    .then((r) => console.log(`  -> webhook ${type}: ${r.status}`))
    .catch((e) => console.log(`  -> webhook ${type} failed: ${String(e)}`));
}

// --- approval screen -------------------------------------------------------

function approvalPage(consent: Consent): string {
  const rows = ACCOUNTS.map(
    (a) => `
      <label class="acct">
        <input type="checkbox" name="link" value="${a.linkRefNumber}" checked>
        <span><strong>${a.fipName}</strong><br><code>${a.maskedAccNumber}</code> &middot; ${a.summaryType}</span>
      </label>`,
  ).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Mock AA &middot; Approve consent</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.55 system-ui, sans-serif; max-width: 30rem; margin: 3rem auto; padding: 0 1.25rem; }
  .card { border: 1px solid #8883; border-radius: 14px; padding: 1.5rem; }
  .tag { display: inline-block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
         background: #8882; border-radius: 99px; padding: .2rem .6rem; margin-bottom: 1rem; }
  .acct { display: flex; gap: .7rem; align-items: center; border: 1px solid #8883;
          border-radius: 10px; padding: .7rem .9rem; margin: .5rem 0; }
  code { font-size: 13px; opacity: .75; }
  .row { display: flex; gap: .6rem; margin-top: 1.25rem; }
  button { flex: 1; padding: .7rem; border-radius: 99px; border: 1px solid #8884;
           font-size: 14px; cursor: pointer; }
  .ok { background: #6d4aff; color: #fff; border-color: #6d4aff; }
  p.note { font-size: 12.5px; opacity: .65; }
</style></head><body>
<div class="card">
  <span class="tag">Mock Account Aggregator</span>
  <h2 style="margin:.2rem 0 .4rem">Share your financial data</h2>
  <p class="note">SpendWise is requesting 12 months of statements for <strong>${consent.vua}</strong>.
     There is no OTP here — this screen stands in for the AA's approval screens.</p>
  <form method="POST">
    ${rows}
    <div class="row">
      <button type="submit" name="decision" value="reject">Deny</button>
      <button type="submit" name="decision" value="approve" class="ok">Approve</button>
    </div>
  </form>
</div></body></html>`;
}

// --- request handling ------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";
  console.log(`${method} ${url.pathname}${url.search}`);

  // POST /v2/consents ------------------------------------------------------
  if (method === "POST" && path === "/v2/consents") {
    const body = await readBody(req);
    const id = randomUUID();
    const expiry = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

    consents.set(id, {
      id,
      status: "PENDING",
      redirectUrl: one(body, "redirectUrl") || "http://localhost:3000/connect-bank",
      vua: one(body, "vua") || "9999999999",
      linked: [],
      expiry,
    });

    console.log(`  consent ${id} -> approve at http://localhost:${PORT}/approve/${id}`);
    return json(res, 201, {
      id,
      url: `http://localhost:${PORT}/approve/${id}`,
      status: "PENDING",
      detail: {
        consentExpiry: expiry,
        purpose: { code: "102", text: "Spending pattern analysis" },
      },
    });
  }

  // GET /v2/consents/:id ---------------------------------------------------
  if (method === "GET" && path.startsWith("/v2/consents/")) {
    const consent = consents.get(path.slice("/v2/consents/".length));
    if (!consent) return json(res, 404, { errorCode: "NotFound", errorMsg: "No such consent" });

    return json(res, 200, {
      id: consent.id,
      status: consent.status,
      detail: { consentExpiry: consent.expiry },
      // Top-level, as the live sandbox sends it: `fiType` is the coarse
      // DEPOSIT, `accType` the fine SAVINGS/CURRENT.
      accountsLinked: ACCOUNTS.filter((a) => consent.linked.includes(a.linkRefNumber)).map((a) => ({
        fipId: a.fipId,
        fipName: a.fipName,
        linkRefNumber: a.linkRefNumber,
        maskedAccNumber: a.maskedAccNumber,
        fiType: "DEPOSIT",
        accType: a.summaryType,
      })),
    });
  }

  // POST /v2/sessions ------------------------------------------------------
  if (method === "POST" && path === "/v2/sessions") {
    const body = await readBody(req);
    const consentId = one(body, "consentId");
    const consent = consents.get(consentId);

    if (!consent || consent.status !== "ACTIVE") {
      return json(res, 400, { errorCode: "InvalidRequest", errorMsg: "Consent is not ACTIVE" });
    }

    const id = randomUUID();
    sessions.set(id, { id, consentId, reads: 0 });
    console.log(`  session ${id} for consent ${consentId}`);
    notify("SESSION_STATUS_UPDATE", { consentId, dataSessionId: id, status: "COMPLETED" });
    return json(res, 201, { id, status: "PENDING" });
  }

  // GET /v2/sessions/:id ---------------------------------------------------
  if (method === "GET" && path.startsWith("/v2/sessions/")) {
    const session = sessions.get(path.slice("/v2/sessions/".length));
    if (!session) return json(res, 404, { errorCode: "NotFound", errorMsg: "No such session" });

    const consent = consents.get(session.consentId);
    session.reads += 1;

    // The FIPs have not delivered yet. Real sessions sit here for seconds to
    // a minute, and a caller that assumes the first read has data is a
    // caller that silently imports nothing.
    if (session.reads <= PENDING_READS) {
      return json(res, 200, { status: "PENDING", fips: [] });
    }

    const linked = ACCOUNTS.filter((a) => consent?.linked.includes(a.linkRefNumber));

    const fips = linked.map((account, index) => {
      // --partial: the second FIP times out. PARTIAL is worth ingesting —
      // one slow bank should not cost the user the accounts that answered.
      const timedOut = PARTIAL && index === 1;
      const transactions = timedOut ? [] : buildTransactions(account);

      return {
        fipID: account.fipId,
        accounts: [
          {
            linkRefNumber: account.linkRefNumber,
            maskedAccNumber: account.maskedAccNumber,
            FIstatus: timedOut ? "TIMEOUT" : "READY",
            ...(timedOut
              ? {}
              : {
                  data: {
                    // No `summary`: the sandbox consent asks for
                    // TRANSACTIONS only, so the live payload has none.
                    account: {
                      // A FIP with exactly one line sends a bare object
                      // rather than a one-element array. The real ones do
                      // this, and a plain `.map()` over it throws.
                      transactions: {
                        transaction: transactions.length === 1 ? transactions[0] : transactions,
                      },
                    },
                  },
                }),
          },
        ],
      };
    });

    return json(res, 200, { status: PARTIAL ? "PARTIAL" : "COMPLETED", fips });
  }

  // GET/POST /approve/:id --------------------------------------------------
  if (path.startsWith("/approve/")) {
    const consent = consents.get(path.slice("/approve/".length));
    if (!consent) return html(res, 404, "<p>No such consent.</p>");

    if (method === "GET") return html(res, 200, approvalPage(consent));

    const body = await readBody(req);
    const approved = one(body, "decision") === "approve";
    const picked = body.link ?? [];

    consent.status = approved ? "ACTIVE" : "REJECTED";
    consent.linked = approved ? picked : [];

    console.log(`  consent ${consent.id} ${consent.status} (${consent.linked.length} account(s))`);
    notify("CONSENT_STATUS_UPDATE", { consentId: consent.id, status: consent.status });

    // Exactly the query string Setu appends, which /connect-bank reads.
    const back = new URL(consent.redirectUrl);
    back.searchParams.set("success", String(approved));
    back.searchParams.set("id", consent.id);
    if (!approved) back.searchParams.set("errormsg", "You denied the consent request.");

    res.writeHead(302, { Location: back.toString() });
    return res.end();
  }

  json(res, 404, { errorCode: "NotFound", errorMsg: `No route for ${method} ${path}` });
});

server.listen(PORT, () => {
  console.log(`\nMock AA gateway on http://localhost:${PORT}`);
  console.log(`Point the app at it:  SETU_AA_BASE_URL=http://localhost:${PORT}`);
  console.log(
    `Serving ${ACCOUNTS.length} accounts: ` +
      ACCOUNTS.map((a) => `${a.fipName} ${a.maskedAccNumber} (${a.summaryType})`).join(", "),
  );
  if (WEBHOOK_URL) console.log(`Notifications -> ${WEBHOOK_URL}`);
  if (PARTIAL) console.log("--partial: second FIP will TIMEOUT, sessions report PARTIAL");
  console.log(`Sessions report PENDING for the first ${PENDING_READS} read(s).\n`);
});
