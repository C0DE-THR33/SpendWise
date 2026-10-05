# SpendWise — Project Conventions

This is the document we wish had existed before we started. It's written
as if SpendWise were being built from scratch today (September 2026),
distilling everything the first build actually taught us — including
three things that turned out different from what a knowledgeable
engineer would have assumed going in. Read this before writing code, not
after debugging why something didn't match your mental model.

**A living document, not a spec.** When a convention here stops matching
reality — a library moves on, a pattern gets replaced — update this file
in the same commit. A conventions doc that's quietly wrong is worse than
none.

---

## 1. Stack, and why each piece is pinned the way it is

| Layer | Choice | Pinned at |
|---|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS v4 | Next 16.3.4, `typescript` 5.9.3 |
| Backend | Next.js Route Handlers (no separate API server) | — |
| Database | PostgreSQL via Supabase | — |
| ORM | Prisma, **classic CLI** | `prisma` / `@prisma/client` `6.19.3` |
| Auth | Supabase Auth (magic link) via `@supabase/ssr` | `0.12.6` |
| Bank data | Setu Account Aggregator sandbox | — |
| Categorization | Claude API (rules first, LLM for ambiguous cases) | — |
| Analytics | PostHog | — |

**Why the exact pins matter here, specifically**: `npm install prisma`
today resolves to **7.10.0**, a from-scratch CLI rewrite (`deploy`,
`branch`, `contract`, no `generate`/`migrate dev`) built around Prisma's
own hosted Postgres — architecturally incompatible with a self-hosted
Supabase + migrations setup. `6.19.3` is the last release with the
classic CLI this whole project assumes. **Don't bump `prisma`/
`@prisma/client` past 6.x without re-reading this paragraph and checking
whether the classic CLI still exists at whatever version you're
considering.**

A fourth, found on a later rebuild: `npm install typescript` resolves to
**7.x**, a version `eslint-config-next` 16.3.4's bundled `typescript-eslint`
(8.70.0) explicitly rejects (`>=4.8.4 <6.1.0`) — `npm install` succeeds
with an `ERESOLVE... overriding peer dependency` warning easy to scroll
past, and the failure only shows up later as ESLint erroring on every
file. `5.9.3` (latest 5.x) is what's pinned here. **Don't bump
`typescript` past 5.x without checking that `eslint-config-next`'s
`typescript-eslint` dependency has caught up.** Same story one layer up:
`npm install eslint` resolves to **10.x**, which `eslint-config-next`'s
own bundled `eslint-plugin-react`/`eslint-plugin-jsx-a11y` cap below —
its own stated peer range (`>=9.0.0`, no upper bound) doesn't tell you
that. `eslint` is pinned at `9.39.5` here for the same reason.

And `eslint.config.mjs`'s shape itself moved on: the `FlatCompat` +
`compat.extends("next/core-web-vitals", "next/typescript")` pattern every
tutorial (and this project's first build) uses now throws
`TypeError: Converting circular structure to JSON` against
`eslint-config-next` 16.3.4 — that package's default export is already a
flat `Linter.Config[]` array (`node_modules/eslint-config-next/dist/index.d.ts`),
so the fix is `import nextConfig from "eslint-config-next"; export default
[...nextConfig, { ignores: [...] }];`, no `FlatCompat` at all.

More generally: **verify a library's current shape against its own
current docs before writing code against it, every time, even for
libraries you're confident about.** Training-data familiarity is exactly
what makes a breaking change invisible until it breaks. This project hit
four of these across two builds (below) — none would have been caught by
"I already know how this works."

---

## 2. Repository layout

```
prisma/
  schema.prisma             full data model, with rationale in comments,
                             not just field lists
  seed.ts                   defaults only (categories) — safe to run
                             against ANY environment
  seed-demo.ts               rich demo data for ONE named user — requires
                             that user to already exist (real sign-in first)
src/
  proxy.ts                  session refresh + redirect-to-/login (see
                             "Next.js 16 renamed middleware" below)
  app/
    onboarding/, connect-bank/, login/, auth/callback/
                             top-level screens outside the tab-bar shell
    (app)/                  route group sharing the bottom-nav shell;
                             `export const dynamic = "force-dynamic"` on
                             its layout.tsx (see "Force-dynamic" below)
      error.tsx              one error boundary for the whole group
    api/                    Route Handlers, one folder per resource
  components/
    <domain>/Component.tsx  grouped by domain (transactions/, nav/, auth/),
                             not by "atoms/molecules" or type
  lib/
    queries.ts               the ENTIRE query layer — see below
    auth.ts                  current-user lookup, the one place that
                             calls Supabase for "who is this"
    supabase/{client,server,proxy}.ts
                             three client factories, never construct a
                             Supabase client any other way
    categories.ts, dates.ts, donut.ts
                             pure, dependency-free helpers — the kind of
                             logic you can unit-test without a database
                             (and should, see "Verification" below)
```

**Rule**: a file's location should answer "where do I look for X" without
needing to know who wrote it. If you're unsure whether something is a
`lib/` helper or a `components/` piece, ask: does it return JSX? If no,
`lib/`.

---

## 3. Design system

A single agreed reference is the **source of truth** for visual
decisions — colors, spacing, the icon-tile system, copy tone. Code should
port it faithfully, then extend it, never invent a parallel aesthetic.
Concretely:

> 🔄 **The reference changed (20 September 2026).** The source of truth is
> now the target UI supplied by the product owner (the four reference
> screens: home, analytics, wireframes, add-expense), **not**
> the v1 HTML design canvas (removed; `git show 7180f69:design/` has it),
> and a visual question is answered from the target UI now, and
> `globals.css` carries its palette: near-white ground, pure white cards,
> a **violet** primary, and category hues amber / green /
> blue / cyan / violet / gray. The teal-accent canvas palette this file
> previously told you to restore is superseded; do not "fix" globals.css
> back to it.
>
> What the transformation changed, beyond color: the bottom bar is a dark
> floating pill with **four tabs and a raised add button** (so /more moved
> to the avatar in `PageHeader`, and the add-cash sheet is reachable from
> every tab); category tiles are soft-tinted rather than saturated chips;
> Analytics gained a real Day / Week / Month / Year control backed by
> `rangeFor()` in `lib/dates.ts`; and the category row shared by Home,
> Analytics and Budget is one component, `components/CategoryStatRow.tsx`.
>
> Screens are checked against it without a database through
> `/design-preview`, a fixture-rendered dev-only route that 404s in
> production.
>
> **Still open — the sixth category.** The canvas's sixth swatch is
> **income**; `lib/categories.ts` ships **other**. `--color-cat-income`
> is defined and currently unused, so the hue isn't lost, but the two
> aren't reconciled. This is a product question, not a find-and-replace:
> whether income is a spending category at all touches `CATEGORY_ICONS`,
> the seed data, and the `direction: CREDIT` handling in `queries.ts`.
> Decide it before wiring that token to anything.

### Depth, and why the first pass read as flat

A palette alone doesn't make an interface feel substantial. The first
implementation used every correct token and still looked meek. What was
missing was in four places, and they're worth stating as rules:

- **One saturated plane, not several tinted ones.** The target UI puts
  the weight in a single filled accent card — Home's hero — and leaves
  every other card pure white on a near-white ground. Hero gets the fill
  (`--color-accent`, as a gradient), list cards stay on
  `--color-surface`, and the ground is `--color-bg`. The earlier rule here
  tinted every hero panel with `--color-accent-soft`; that reads as muddy
  against a white-card design, and `--color-accent-soft` is now for small
  soft accents (icon wells, the connect-bank prompt) rather than whole
  panels.
- **Icons need a body.** A 1.75px hairline glyph disappears against a
  saturated tile at 18px. Category icons are two-tone: translucent
  `currentColor` fill behind a solid stroke, so the shape is readable at
  tile size. Still inline stroke-SVG — the rule below is unchanged, the
  weight is what changed.
- **Numbers carry the hierarchy.** Money is the content of a finance app,
  so amounts are bold and large with `tabular-nums` (the `.tnum` class);
  proportional digits make a column of amounts visibly ragged.
- **A bare progress bar says nothing.** 75% spent is healthy on the 25th
  and alarming on the 8th, so every budget bar draws the month's own
  progress as a marker on the same axis (`BudgetPaceBar`). Prefer showing
  the comparison over making the reader compute it.

**On borrowing from other apps.** Taking visual *inspiration* from
another product is fine and normal — layout, density, and color
direction aren't copyrightable. Copying its **asset files** is not the
same act. Cashew, the reference for this pass, is GPL-3.0: bundling its
artwork would oblige SpendWise (currently unlicensed, so
all-rights-reserved) to become GPL-3.0 with published source. Check the
licence before copying any file out of another repository, and when in
doubt draw it yourself — which the inline-SVG rule below already
requires.

- **Every color is a CSS custom property**, defined once in
  `src/app/globals.css`'s `:root` and mapped into Tailwind's `@theme
  inline` block, so `bg-accent`, `text-danger-fg`, `bg-cat-food` etc. are
  real utility classes, not one-off hex codes sprinkled through
  components. If a design decision needs a new color, it gets a token
  first, a usage second.
- **`@layer base` for anything that could win the cascade it shouldn't.**
  A bare `a { color: ... }` outside a layer beats *every* Tailwind
  utility on every link, specificity be damned — the CSS cascade-layers
  spec puts any unlayered rule ahead of any layered one. Anything that
  isn't itself a utility override belongs in `@layer base`.
- **The icon-tile system** (`components/transactions/CategoryTile.tsx`)
  is the one way a category ever renders — a colored rounded-square tile
  with a hand-drawn stroke-SVG icon, `size="sm"|"md"|"lg"`, an optional
  `selected` ring+badge state. A `DashedTile` sibling covers "uncategorized"
  and "add category." Never fall back to a plain colored dot or a letter
  avatar for a category once this exists — consistency across every
  screen is the entire point (see the "uncategorized as a full citizen"
  entry below for why this discipline matters).
- **No fake OS chrome.** Never draw a fake status bar or virtual keyboard
  inside a mobile mockup or a real page — the real one renders on top and
  a painted fake looks doubled up.
- **Icons are inline stroke-SVG, one consistent grid (16/20/24px),
  `currentColor` or an explicit stroke — never emoji, never a icon font.**

---

## 4. Data layer conventions

**One query function per page's actual need, in `lib/queries.ts`, called
directly from a Server Component.** Not a generic repository/DAO
abstraction, not a GraphQL-style resolver graph — a page needs `getBudgetData(userId)`,
it gets exactly that function, returning exactly the shape that page
renders. Shared logic (this month's category breakdown, used by both
Home and Analytics) is a private helper inside `queries.ts`, not
duplicated.

- **Server Components fetch; Client Components only hold interaction
  state.** A page that's mostly display with a little interactivity
  (Transactions) splits into `page.tsx` (server, fetches, `async`) +
  a client component that receives the fetched data as props and owns
  only the UI state (filter selection, sheet open/closed).
- **Decimal fields**: Prisma returns `Prisma.Decimal`, not `number`.
  Every query function converts with a `toNum()` helper at the boundary —
  never let a `Decimal` leak into a component prop or a `.toLocaleString()`
  call.
- **A DB column typed as plain `string` that's conceptually a closed set**
  (`Category.icon` is one of six known values, but Postgres doesn't
  enforce that) **needs a runtime narrowing function at the read boundary**
  (`asCategoryIcon()`), not a cast. Log and fall back on an unexpected
  value; never let one bad row crash a whole page render.
- **A percentage breakdown of "spend by category" must account for spend
  that has no category**, or the percentages silently don't sum to 100%
  and the gap is invisible. Give "uncategorized" its own row in the
  breakdown (see the retrospective below) rather than excluding it from
  the total.
- **Every list-fetching query has a real empty-state design**, decided
  at the same time as the query, not bolted on later. "What does this
  page look like for a brand-new user with nothing yet" is a product
  question, answer it before writing the JSX.

---


## 4b. Categorization rules

`lib/categorize.ts` is the deterministic pass — the "rules first" in #1's
"rules first, LLM for ambiguous cases". It is pure (no db, no network) so
it is verifiable with a throwaway script, and the DB-touching half lives
in `lib/auto-categorize.ts`, shared by the Setu ingest path and the
`db:categorize` backfill so neither grows its own copy.

Three rules that are not obvious until they break:

- **Match whole words, never substrings.** `OLA` is a substring of
  CHOCOLATE, SOLAR, GORILLA and TESLA; `LIC` of LICENSE; `PVR` of SPVRX.
  Substring matching on short merchant names files a chocolate purchase
  under Transport and gives no sign it did.
- **Brands are a tier above generic keywords, not just longer strings.**
  The first version ranked purely by phrase length, so the generic
  keyword `RECHARGE` (bills, 8 chars) beat the brand `METRO` (transport,
  5) and filed a metro top-up under Bills. Named merchants are matched as
  a class first; only if none hit does the generic pass run. Within a
  tier, longer wins, which is what makes `AMAZON PRIME` beat `AMAZON`.
- **Return null rather than guess.** An unmatched transaction stays
  visibly Uncategorized — a real state the UI renders (#4) and the
  hand-off point for the LLM pass. A wrong automatic category is worse
  than an honest blank one: the user cannot tell it is wrong without
  auditing every row, and the budget misreports until they do.

**Never overwrite a human.** `categorySource` distinguishes RULE / LLM /
MANUAL, and MANUAL includes the decision to *clear* a category back to
uncategorized — so the categorize route records MANUAL even when setting
`categoryId: null`. Without that, a deliberate "mark as uncategorized" is
indistinguishable from "never categorized" and the next backfill silently
overrides it. Re-syncs use `update: {}` for the same reason.

**Demo data must go through the real rules.** `seed-demo.ts` used to leave
a random 10% of *all* merchants uncategorized, which produced rows like
"Uber — Uncategorized" and made the feature look broken. It now
categorizes through `categorizeByRules` and draws its deliberately
uncategorized slice from merchants the rules genuinely cannot place, so
the uncategorized state still has real data behind it without any
recognizable merchant being left unsorted.

## 4c. Account Aggregator conventions

The AA flow is the one place where a third party calls *us*, and where the
thing identifying a user arrives as a bare uuid in a query string. Four
rules follow from that.

- **A consent id is not an identity.** Both paths back from Setu — the
  browser redirect to `/connect-bank?id=…&success=true` and the webhook —
  carry a consent id and nothing else trustworthy. `AaConsent` exists so
  that id can be turned into a user id by a row *we* wrote before the
  redirect ever happened. Setu will echo whatever you put in the consent's
  `context`, and it is fine to send `userId` there, but reading it back is
  not an ownership check.
- **An unauthenticated webhook may name a fact, never assert one.**
  `/api/aa/webhook` is on the public allowlist and Setu documents the
  notification payloads without documenting a signing scheme. So the route
  takes only the ids from the body and re-reads the consent or data session
  from Setu's API with our own credentials before touching a row. A forged
  POST can make the server re-read something it already owns; it cannot
  assert a status or file a transaction. The signature check is defence in
  depth on top of that — and note what the previous stub did instead:
  returning `false` unconditionally, which silently rejected every real
  notification rather than every forged one.
- **`linkRefNumber` is the join key, not the masked account number.** FI
  data arrives nested per FIP per account in one payload covering the whole
  consent, and masked numbers are not unique across FIPs. Scoping that
  lookup by `userId` is also what makes ingest safe: a session belonging to
  someone else resolves to zero of this user's accounts and writes nothing.
- **Fetching data is two calls, and the first one is asynchronous.**
  `POST /sessions` asks the AA to go collect; `GET /sessions/:id` returns
  `PENDING` until the FIPs deliver. `PENDING` is not an empty statement —
  a UI that treats it as one tells the user their bank has no transactions.
  The session's range must also sit inside the consent's, which is why
  `AaConsent` stores the range it was raised with rather than recomputing
  "the last twelve months" later and drifting past the boundary.

- **A consent carries no application identity, by construction.** The
  gateway validates `context` keys against a fixed vocabulary
  (`accounttype`, `fipId`, `consentReviewAt`, `purposeDescription`,
  `purposeCode`, `alternateNumber`, `accountSelectionMode`,
  `transactionType`, `excludeFipIds`, `excludeFipIdsByFiType`) and 400s on
  anything else — so `userId` cannot be smuggled through it. The `AaConsent`
  row isn't just the trustworthy mapping from consent id to user, it is the
  only one that exists.

Worth recording as a case study for #8, in two layers. The original Setu
client had every endpoint shape wrong — the consent body and response, the
number of calls needed to read data, the nesting of the data itself —
because it was written from familiarity rather than from the docs. It
typechecked, linted, and would have failed on the first live call.

Then the docs-based rewrite was *still* wrong in three ways that only a real
call could expose, which is the more useful half of the lesson:

- **The documented path is unversioned; the live sandbox only serves `/v2`.**
  Worse, the unversioned path is routed to something that answers valid
  credentials with `401 INVALID_CREDENTIALS`, so the symptom accuses the
  keys and says nothing about the URL. An hour could go into re-issuing
  correct credentials. The tell was that the *same headers* got a business
  error (`400 Customer vua not found`) from `/v2/consents` — proof that
  authentication had succeeded and only the path was wrong.
- **Linked accounts come back in a top-level `accountsLinked` array**, not
  the `detail.accounts` the consent object documentation implies.
- **`context` is a closed vocabulary** (above), not free-form key/values.

The rule this earns, on top of "read the current docs": **for any external
API, make one real call before believing the integration is finished, and
build the thing that makes that call cheap** — here `npm run setu:smoke`,
which needs no database row, no session, and no browser. All three of the
above surfaced within minutes of the first one.

## 5. Auth conventions

- **`src/proxy.ts`** (not `middleware.ts` — see below) refreshes the
  session and redirects unauthenticated requests away from anything not
  on an explicit public-path allowlist. **Uses `getClaims()`, never
  `getSession()`** — `getClaims()` verifies the JWT signature;
  `getSession()` trusts whatever the request's cookies claim, which is
  not a safe basis for a security decision.
- **`lib/auth.ts`'s `getCurrentUser()`/`getCurrentUserId()`** is the
  *only* place application code asks "who is signed in." It upserts the
  matching Prisma `User` row defensively (the real creation happens in
  `auth/callback/route.ts` right after sign-in; this is a second line of
  defense for a session that predates that, not the primary path). Both
  are wrapped in React's `cache()` — the `(app)` layout calls
  `getCurrentUser()` to guard the whole route group, and every page under
  it calls it again for its own data. Without `cache()` that's a second
  Supabase round-trip *and* a second Prisma upsert on every page load;
  found by actually loading a page and reading the server log, not by
  `tsc` (CONVENTIONS.md #8 again).
- **`auth/callback/route.ts` must handle both email-link shapes**:
  `?code=` (PKCE) *and* `?token_hash=&type=` (verifyOtp). PKCE only works
  when the same browser that called `signInWithOtp()` also clicks the
  link, because exchanging the code needs the `code_verifier` cookie that
  call set — so a `code`-only callback works perfectly in local testing
  and then breaks for any real user who requests the link on a laptop and
  taps it in their phone's mail app. `token_hash` is also what Supabase's
  default email templates and the admin `generateLink()` API produce.
- **Every mutating API route checks both auth AND ownership.** `getCurrentUserId()`
  proves *someone* is signed in; it does not prove the resource being
  mutated belongs to them. A `Transaction` reaches its owner only via
  `linkedAccount.userId` — the correct guard is `updateMany({ where: { id,
  linkedAccount: { userId } } })`, checking `result.count === 0` for "not
  found or not yours," never a bare `update({ where: { id } })`. This
  isn't a hypothetical: the first version of the categorize route shipped
  without this check.
- **A page or route reading Supabase must degrade gracefully when
  Supabase isn't configured**, not throw a raw error — see "SupabaseNotConfiguredError"
  below. This matters more than it sounds: it's the difference between a
  freshly cloned repo being demoable before `.env` is filled in, and
  every single page 500ing. Pages catch `SupabaseNotConfiguredError`
  directly (they want a distinct "set up your .env" screen); API route
  handlers call `lib/auth.ts`'s `getCurrentUserIdOrResponse()` instead of
  `getCurrentUserId()`, which folds that same case into a 503 alongside
  the ordinary 401. Found by actually clicking a button in the browser
  with no `.env` present — `npm run build` has no reason to exercise this
  path, so it stayed invisible until then (CONVENTIONS.md #8).

---

## 6. Database conventions

- **A nullable column in a compound `@@unique` can't back an `upsert`.**
  Postgres treats every `NULL` as distinct for uniqueness purposes, so
  `ON CONFLICT` never fires when the nullable column is null — an
  `upsert` intended as "create once" silently inserts a fresh duplicate
  on every re-run instead. `Category.userId` (null = a shipped default)
  is exactly this shape; `MonthlyBudget`/`CategoryBudget` are split into
  two tables specifically to avoid ever needing a nullable column in a
  unique constraint. Where a nullable-key upsert seems needed, use
  `findFirst` + conditional `create` instead.
- **`not` / `NOT` filters silently exclude NULL rows.** Postgres
  three-valued logic: for a row where `col IS NULL`, `NOT (col = 'X')`
  evaluates to NULL, not true, so the row is filtered out. Both Prisma
  spellings — `NOT: { col: "X" }` and `col: { not: "X" }` — compile to
  that. A backfill meant to skip user-edited rows
  (`NOT: { categorySource: MANUAL }`) matched **zero** of the 10 rows it
  existed to fix, because all of them had a null source, and it reported
  success while doing nothing. When a column is nullable, spell it out:
  `OR: [{ col: null }, { col: { not: "X" } }]`. Any filter written as
  "everything except X" over a nullable column deserves a row count
  before and after.

- **Two seed scripts, two different safety levels.** `seed.ts` (shipped
  defaults, e.g. categories) is safe to run against any environment,
  any number of times. `seed-demo.ts` (rich sample data for one named
  user) is explicitly separate, takes an identifying argument, and
  fails loudly if its precondition (a real signed-in user already
  exists) isn't met. Never conflate "safe defaults" and "demo data" in
  one script.
- **Money is `Decimal(12, 2)`, never `Float`/`Int`.** Convert to `number`
  only at the read boundary (see "Data layer" above), never store or
  compute in floating point.
- **Every schema addition needs a reason written down in the schema
  file itself**, not just in a commit message — `schema.prisma`'s
  comments are the first thing anyone (human or agent) reads to
  understand *why* a table is shaped the way it is, and commit history
  is easy to not think to check.

---

## 7. Environment variables

- **Supabase**: use the **publishable**/**secret** key pair
  (`sb_publishable_...`/`sb_secret_...`), not the legacy `anon`/
  `service_role` JWT-shaped keys — Supabase is deprecating the legacy
  pair by end of 2026. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, not
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Two database URLs, not one**, because Next.js on Vercel is
  serverless: `DATABASE_URL` is the transaction-mode pooled connection
  (port 6543, `?pgbouncer=true`) the *app* uses at runtime — a
  serverless function can't hold a direct connection open without
  exhausting Postgres's connection limit. `DIRECT_URL` is the
  session-mode/direct connection (port 5432) that `prisma migrate`
  needs, since migrations need prepared statements a transaction-mode
  pooler can't sustain. Get both from Supabase's **Connect → ORMs →
  Prisma** tab, pre-filled except the password.
  **Don't hand-build either URL from the raw `db.<ref>.supabase.co`
  hostname** — that hostname is IPv6-only on current Supabase projects,
  and plenty of networks (this one included, at least without IPv6
  routing) can resolve it but can't actually reach it, which shows up as
  a generic `P1001: Can't reach database server` with no hint that IPv6
  is the reason. Supabase's own **Session pooler** endpoint
  (`*.pooler.supabase.com`, still port 5432, still session-mode) is the
  IPv4-compatible equivalent and is what `DIRECT_URL` should actually
  point to — it's right there in the same Connect → ORMs → Prisma tab
  next to the transaction pooler URL, not something to construct by
  hand.
- **`.env.example` is the map of every variable the app needs, with a
  comment on where to get each one** — not just a name and an empty
  string. Someone cloning this repo should be able to go from
  `.env.example` to a working `.env` without leaving the README once.

---

## 8. Verification discipline

This is the part most worth carrying into a fresh start, and the part
that caught every real bug in this project so far.

- **Run it. Don't just read the diff.** `npm run build && npm run lint`
  after every meaningful change, no exceptions — TypeScript against
  Prisma's generated types catches wrong field/relation/enum names,
  which is real signal, not theater.
- **A build passing is not the same as a page working.** Start the dev
  server, actually navigate to the page, actually click the button.
  Two of this project's real bugs (a login button stuck forever on
  "Sending…", a route-group crash that only showed up with zero
  Supabase config) were invisible to `tsc` and only surfaced by loading
  the actual page in a browser.
- **Pure logic gets a standalone test, even without a test framework
  set up.** Donut-chart segment math, date-bucket edge cases, month-
  boundary rollover across a year boundary — none of these need a
  database or a browser to verify, so a five-line throwaway Node script
  checking the actual output against hand-computed expected values is
  cheap insurance. Delete the script after; keep the confidence.
- **When you can't run the real thing (no live database existed for
  most of this build), say so plainly, and say what you did instead** —
  don't imply verification that didn't happen. "TypeScript passed
  against Prisma's generated types" is a real, specific claim; "this
  should work" is not.
- **Before writing code against a library you're confident about,
  check whether that confidence is current.** This project's real
  surprises this way, across two builds:
  - `prisma` resolved to a completely different CLI (7.x) than the
    classic one every tutorial assumes.
  - Next.js 16 renamed `middleware.ts` → **`proxy.ts`**, and moved its
    expected location to alongside `app/` rather than the project root.
  - Supabase renamed `anon`/`service_role` keys to `publishable`/
    `secret`, and the docs' own recommended cookie-handling shape
    (`getAll`/`setAll`, `getClaims()` over `getSession()`) had moved on
    from what training data would suggest.
  - `typescript` resolved to 7.x, which `eslint-config-next`'s bundled
    `typescript-eslint` rejects outright — `npm install` only warns, it
    doesn't fail, so this one hides until ESLint runs.

  All four would have shipped silently wrong without a docs check.
  None of them were exotic — they were exactly the parts a confident
  engineer skips checking.

---

## 9. Git conventions

- **A commit message states what changed, why, what was verified, and
  what wasn't** — not just "wire up X." If a change fixed a bug found
  while building something else, say what the bug was and how it was
  found; that's the information a future reader (human or agent) most
  needs and least often gets.
- **`git status` before staging broadly, always** — review what's about
  to be committed, not just what you meant to change. A `.gitignore`
  gap (this project's `.env*` blanket rule initially ate `.env.example`
  too) is easy to introduce and easy to miss without looking.
- One logical change per commit; a commit that mixes "add feature" with
  "also fix an unrelated bug I noticed" makes both harder to review and
  harder to revert independently.

---

## 10. If we were starting today, what we'd do differently from minute one

- **Check current docs for every major dependency before scaffolding,
  not after hitting a surprise.** Five minutes of "what does Prisma's
  CLI look like today, what does Next's middleware convention look like
  today" up front would have prevented every rework in this list.
- **Design the empty state and the "who owns this row" check at the same
  time as the happy path**, not as a follow-up pass — both of this
  project's real security/correctness bugs (the missing ownership check,
  the uncategorized-spend percentage gap) were exactly the kind of thing
  that's obvious in hindsight and invisible while focused on the primary
  flow.
- **Decide the pooled/direct database URL split before the first
  migration**, not after deploying — retrofitting it is a schema change
  and an env var rename touching every environment.
- **Build the design reference and the code's design tokens from the same
  source values from day one** (this project does do this — `globals.css`'s
  `:root` block is the current reference's palette, nothing else — worth
  keeping deliberate as the project grows, since the two are easy to
  let drift once there are more than a handful of screens).
