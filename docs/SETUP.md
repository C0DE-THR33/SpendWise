# SpendWise — Setup & Development Guide

The full local setup, the Setu Account Aggregator sandbox walkthrough, and
the mock gateway. For an overview of the project, see the
[README](../README.md); for design decisions and the reasoning behind
them, see [CONVENTIONS.md](../CONVENTIONS.md).

## Getting started

1. **Create a Supabase project.** [supabase.com](https://supabase.com) →
   New project.
2. **Copy the env template and fill it in:**
   ```bash
   cp .env.example .env
   ```
   Every variable in `.env.example` has a comment saying exactly where to
   get it — Supabase keys and both database URLs come from your project's
   **Connect** panel (**ORMs → Prisma** tab for the database URLs). Setu
   and Claude API keys are optional for exploring the UI — pages that need
   them degrade gracefully (a disabled button, a clear message) rather
   than crashing when they're unset.
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Push the schema and generate the Prisma client:**
   ```bash
   npx prisma migrate dev --name init
   ```
5. **Seed the default categories** (safe to run anytime, any environment):
   ```bash
   npm run db:seed
   ```
6. **Run the app:**
   ```bash
   npm run dev
   ```
7. Sign in with a magic link at `/login`, then optionally seed rich demo
   data for that account (requires signing in once first):
   ```bash
   npm run db:seed:demo -- you@example.com
   ```

## Connecting the Setu AA sandbox

Bank data arrives through [Setu's Account Aggregator gateway](https://docs.setu.co/data/account-aggregator).
The app runs fine without it — `/connect-bank` degrades to a clear "not
configured" message rather than crashing (CONVENTIONS.md #5) — but nothing
imports until a sandbox project exists.

1. **Create the FIU and product.** On [bridge.setu.co](https://bridge.setu.co),
   go to Account Aggregator → **Set up another FIU** (company PAN and GSTIN;
   sandbox does not validate them) → open **FIU businesses**, pick the
   account, and create the **Account Aggregator - Data** product.

   The product instance is wired to an account aggregator on the Bridge —
   Onemoney, for every sandbox FIU tried so far — and nothing in the request
   can change that.

   **Approve with a real mobile number you can receive an OTP on, not
   `9999999999`.** Onemoney's approval screen refuses the dummy number,
   including with the documented `123456`, as *"Incorrect OTP! Please
   check."* — three redirects away from anything this codebase controls, and
   only after the consent id and approval URL came back exactly like a
   working flow. That is what stalled the first attempt at this integration,
   which blamed it on Onemoney needing numbers whitelisted. It doesn't: a
   real number went straight through, with no request to Setu, to an ACTIVE
   consent and a delivered data session (verified 2026-10-03 with
   `prototypes/setu-aa`).

   **Leave `SETU_AA_HANDLE` empty** so the app sends a bare mobile number.
   That does not pick an AA — nothing in the request can — it just avoids
   naming one the FIU is not registered with. Probed against the live
   sandbox on one set of credentials:

   | `vua` sent | Result |
   |---|---|
   | `9999999999` | **201 in 0.9s** — routed to whatever the Bridge says |
   | `9999999999@onemoney` | 201 — the same AA, named explicitly |
   | `9999999999@setu` | 500 — handle recognised, AA unreachable |
   | `9999999999@finvu` | 400 — `fair use rules template id: null` |
   | `9999999999@anumati` | 400 — `not as per Fair Usage Policy` |
   | `9999999999@saafe` | 400 — handle not supported |

   The finvu and anumati rejections are this FIU not being registered with
   those AAs rather than a malformed request: a null fair-use template means
   no policy exists for the FIU there, so its permitted consent frequency is
   zero. Getting one of them is an onboarding request to Setu
   (`aa@setu.co`), not a config change.

2. **Configure the consent object** in Step 1. Purpose, FI types, fetch type
   and consent mode all live on the Bridge, not in this codebase — the app
   only sends the parts that vary per request (who, how long, over what date
   range, where to redirect back to). What SpendWise needs:

   | Setting | Value | Why |
   |---|---|---|
   | Purpose | **102** — spending pattern analysis | Literally what this app does; the purpose code is shown to the user on the approval screen |
   | FI types | **DEPOSIT** | Savings/current accounts. Add others only when the app can actually render them |
   | Consent types | **TRANSACTIONS**, plus SUMMARY and PROFILE | Transactions are the product; summary carries the account type and balance. Without it (the sandbox default) the type comes from the consent and the balance from the latest transaction |
   | Fetch type | **PERIODIC** | ONETIME allows a single data session ever, so every sync after the first would fail |
   | Consent mode | **STORE** | Transactions are written to our own database, not just displayed |
   | Frequency | as high as the form allows | Only `POST /sessions` counts against it, but the default of **1 per hour** means a second manual sync within the hour is rejected |

   Two things worth setting deliberately while you are in there: the
   **purpose text** shown on the approval screen defaults to Setu's loan
   example ("To verify your income and calculate loan offer"), which is not
   what this app does; and under *Advanced options*, leave auto-fetch off
   (the app opens its own data sessions) but turn **partial fetch on**, so
   one slow FIP doesn't cost you the accounts that did respond.

3. **Copy the credentials** from *Step 2 — Test your product* into `.env`:
   `SETU_CLIENT_ID`, `SETU_CLIENT_SECRET`, `SETU_PRODUCT_INSTANCE_ID`.
   Leave `SETU_AA_BASE_URL` at the sandbox host.
4. **Point Setu's notifications at this app.** Setu posts consent and data
   updates server-to-server, so `localhost` is not reachable — expose the
   dev server with a tunnel and set the Bridge notification URL to
   `https://<your-tunnel>/api/aa/webhook`. If the Bridge lets you attach a
   shared secret, put the same value in `SETU_WEBHOOK_SECRET` and the route
   will require a matching `x-setu-signature`.
5. **Smoke-test the credentials before touching the app.** This exercises
   the gateway from the terminal — no database row, no sign-in — and prints
   what the parsers made of each response, so a renamed field shows up as
   one line of output instead of an empty screen:
   ```bash
   npm run setu:smoke -- consent <your mobile number>
   ```
   Use your own number: `9999999999` raises a consent fine but can never be
   approved (step 1). For a browser version that shows every raw payload,
   including the redirect and webhooks, run
   `node prototypes/setu-aa/server.mjs` and open `localhost:4200`.
   Approve at the printed URL, then `npm run setu:smoke -- status <id>` and
   `npm run setu:smoke -- fetch <id>`. Add `--raw` to any of them to see
   Setu's untouched JSON alongside the parsed result.
6. **Run the flow for real.** Sign in, open `/connect-bank`, enter a
   real 10-digit mobile number you can receive OTPs on, and approve on
   Setu's screens.

   Two mock FIPs are attached to sandbox products, and they behave
   differently at the OTP step: **Setu FIP** sends a dynamic OTP to the
   number the consent was raised for, while **Setu FIP-2** uses the static
   OTP `123456`. Either works with a real number. Setu FIP links three
   accounts, one of which (`FAILUREXXXXX`) always comes back `DENIED` with
   no data, so its sessions finish `PARTIAL` — a free test of the
   partial-ingest path.

What happens after you approve:

| Step | Route | What it does |
|---|---|---|
| Consent raised | `POST /api/aa/consent` | Creates the consent with Setu and records `aa_consents` (the only mapping from Setu's consent id back to a user) |
| Back from Setu | `POST /api/aa/link` | Re-reads the consent, creates a `LinkedAccount` per account approved, opens a data session |
| Data fetch | `POST /api/aa/sync` | Pulls the session and upserts transactions, categorizing on the way in |
| Out of band | `POST /api/aa/webhook` | Same two steps, driven by Setu's notifications, for users who close the tab |

**Sync is idempotent and never overwrites a human.** Re-running it no-ops
rows already stored (`[linkedAccountId, externalId]` is a real compound
unique) and leaves any category the user set by hand alone.

## Running the flow without Setu

The sandbox needs a real phone in the loop for every approval, and Setu
needs a public URL to deliver webhooks. `scripts/mock-aa.ts` stands in for
the aggregator so the rest of the flow can be run quickly and repeatably
without either:

```bash
npm run mock:aa -- --webhook http://localhost:3000/api/aa/webhook
```

Then point the app at it and restart the dev server:

```
SETU_AA_BASE_URL=http://localhost:4100
```

That is the whole integration. It serves the same four endpoints under the
same `/v2` prefix, so the app reaches it through the ordinary client with
the ordinary credentials check, and no code path is special-cased for it —
switching back to the real gateway is the same one line.

Open `/connect-bank`, enter any 10-digit number, and the mock's approval
screen offers two accounts to tick. Approving redirects back with the same
`?success=true&id=…` Setu appends, and the app links, fetches and
categorizes roughly 470 transactions across twelve months.

It is a stand-in for the *aggregator*, not a fake for `lib/setu.ts`, and
the payloads are deliberately awkward in the ways real relayed FIP data is:
XML-derived casing (`fipID`, `FIstatus`, `maskedAccNumber`), a single
transaction arriving as a bare object rather than a one-element array, and
no statement `summary`, so the balance has to come from the transactions —
the same shape the live sandbox returned on 2026-10-03. A mock that sent
tidy JSON would let a broken parser pass.

| Flag | Effect |
|---|---|
| `--port 4200` | Serve somewhere else |
| `--webhook <url>` | Post `CONSENT_STATUS_UPDATE` / `SESSION_STATUS_UPDATE` notifications, so the out-of-band path runs too |
| `--pending-reads 3` | Make sessions report `PENDING` for three polls before delivering |
| `--partial` | Second FIP `TIMEOUT`s and the session reports `PARTIAL` |

Statement data is generated from a seeded PRNG, so it is identical across
runs — which is what makes "sync twice, expect the row count not to move" a
test of the upsert rather than of the generator.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run db:generate` | Regenerate the Prisma client after a schema change |
| `npm run db:migrate` | Create/apply a migration (`prisma migrate dev`) |
| `npm run db:seed` | Seed shipped defaults (categories) |
| `npm run db:seed:demo -- <email>` | Seed rich demo data for one existing user |
| `npm run dev:signin -- <email>` | Mint a sign-in link without sending email (dev only) |
| `npm run db:categorize -- <email>` | Apply merchant rules to existing uncategorized transactions (`--dry-run` to preview) |
| `npm run setu:smoke -- <cmd>` | Probe the Setu AA sandbox from the terminal (`consent` / `status` / `fetch`, `--raw`) |
| `npm run mock:aa` | Serve a local stand-in for the AA gateway, so the bank-connect flow runs without Setu |

### Signing in locally

Supabase's built-in email service is rate-limited to roughly **2 messages
per hour, project-wide** — it exists for testing, not real use — so the
normal magic-link flow stalls quickly in development, and it can't work
at all for a demo address that isn't a real mailbox. For local work, mint
a link directly instead:

```bash
npm run dev:signin -- you@example.com
```

Paste the printed URL into whichever browser you want signed in. It's
single-use and expires, so run it again for a fresh one. Requires
`SUPABASE_SECRET_KEY` in `.env`.

Before anyone other than you signs in, configure custom SMTP under
**Authentication → SMTP Settings** in the Supabase dashboard — that
removes the cap and makes the real magic-link flow usable.

## Verification

Before committing, at minimum:

```bash
npm run build && npm run lint
```

A passing build is necessary but not sufficient — see CONVENTIONS.md §8
before assuming a page actually works from that alone.
