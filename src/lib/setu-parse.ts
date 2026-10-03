// Pure parsers for Setu AA response payloads. No network, no env, no db —
// so the shapes below can be verified against a captured sandbox response
// with a throwaway script instead of a live consent flow (CONVENTIONS.md
// #8). The transport half lives in lib/setu.ts.
//
// Everything here is written defensively on purpose. Setu's FI data is
// relayed from each FIP and reaches us as JSON converted from the
// NBFC-AA XML schema, so casing drifts between fields and between FIPs
// (`fipID` / `fipId`, `FIstatus` / `FIStatus`, `maskedAccNumber` /
// `maskedAccountNumber`), and an unrecognised block must degrade to "skip
// this account" rather than crash a sync of five others — the same
// read-boundary narrowing rule the query layer follows (CONVENTIONS.md #4).

/** Case-insensitive, multi-alias field read for a relayed FIP payload. */
function field(source: unknown, ...names: string[]): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  const record = source as Record<string, unknown>;
  for (const name of names) {
    if (record[name] !== undefined) return record[name];
  }
  const lowered = new Map(
    Object.keys(record).map((key) => [key.toLowerCase(), key] as const),
  );
  for (const name of names) {
    const actual = lowered.get(name.toLowerCase());
    if (actual !== undefined && record[actual] !== undefined) return record[actual];
  }
  return undefined;
}

function str(source: unknown, ...names: string[]): string | null {
  const value = field(source, ...names);
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

/**
 * A field that is an array of one shape, an object when the FIP sent
 * exactly one, or absent when it sent none — the standard ambiguity of
 * XML-derived JSON, and the reason a bare `.map()` over it throws on the
 * single-transaction account.
 */
function list(source: unknown, ...names: string[]): unknown[] {
  const value = field(source, ...names);
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

// --- Consent ---------------------------------------------------------------

/** One account the user linked while approving a consent. */
export interface ParsedConsentAccount {
  fipId: string;
  fipName: string | null;
  linkRefNumber: string;
  maskedAccountNumber: string;
  /** FIP's own account type string, e.g. SAVINGS / CURRENT / CREDIT_CARD. */
  accountType: string | null;
}

/**
 * Takes the whole consent payload. The live gateway returns the accounts a
 * user linked in a top-level `accountsLinked` array; the documented consent
 * object suggested `detail.accounts`. Both are accepted, because the one
 * that is actually populated was only discoverable by approving a real
 * consent and looking.
 */
export function parseConsentAccounts(consent: unknown): ParsedConsentAccount[] {
  const accounts: ParsedConsentAccount[] = [];

  const source = [
    ...list(consent, "accountsLinked", "accounts", "Accounts"),
    ...list(field(consent, "detail"), "accountsLinked", "accounts", "Accounts"),
  ];

  for (const raw of source) {
    const linkRefNumber = str(raw, "linkRefNumber", "linkReferenceNumber");
    const fipId = str(raw, "fipId", "fipID", "FIPID");
    const maskedAccountNumber = str(raw, "maskedAccNumber", "maskedAccountNumber");

    // Without a link reference there is no way to attribute the FI data
    // that arrives later, so an account missing one is unusable rather
    // than merely incomplete — log it and skip.
    if (!linkRefNumber || !fipId || !maskedAccountNumber) {
      console.warn("Skipping consent account with missing identifiers", { linkRefNumber, fipId });
      continue;
    }

    accounts.push({
      fipId,
      fipName: str(raw, "fipName", "fipHandle"),
      linkRefNumber,
      maskedAccountNumber,
      accountType: str(raw, "accType", "accountType", "FIType", "fiType"),
    });
  }

  return accounts;
}

// --- FI data session -------------------------------------------------------

export interface ParsedTransaction {
  externalId: string;
  /** Left as a string: it becomes a Decimal(12,2), never a float (CONVENTIONS.md #6). */
  amount: string;
  direction: "DEBIT" | "CREDIT";
  description: string;
  mode: string | null;
  transactionDate: Date;
}

export interface ParsedAccountData {
  fipId: string;
  linkRefNumber: string;
  maskedAccountNumber: string | null;
  /** READY / PENDING / DELIVERED / TIMEOUT / DENIED, as reported per account. */
  status: string | null;
  accountType: string | null;
  currentBalance: string | null;
  transactions: ParsedTransaction[];
}

export interface ParsedDataSession {
  /** Combined session status: PENDING / PARTIAL / COMPLETED / EXPIRED / FAILED. */
  status: string | null;
  accounts: ParsedAccountData[];
}

function parseTransaction(raw: unknown): ParsedTransaction | null {
  const externalId = str(raw, "txnId", "txnID", "transactionId");
  const amount = str(raw, "amount");
  const type = str(raw, "type", "direction");

  if (!externalId || !amount || !type) return null;

  const direction = type.toUpperCase() === "CREDIT" ? "CREDIT" : "DEBIT";

  // `transactionTimestamp` is the precise one; `valueDate` is the date the
  // FIP booked it and is all some FIPs send.
  const timestamp = str(raw, "transactionTimestamp", "valueDate");
  const transactionDate = timestamp ? new Date(timestamp) : null;
  if (!transactionDate || Number.isNaN(transactionDate.getTime())) return null;

  // A number with no dot ("2500") is as valid as "2500.00" here; what is
  // not valid is anything Prisma's Decimal cannot take, which would fail
  // the whole batch insert rather than this one row.
  if (!/^-?\d+(\.\d+)?$/.test(amount)) return null;

  return {
    externalId,
    amount,
    direction,
    description: str(raw, "narration", "description", "remarks") ?? "",
    mode: str(raw, "mode"),
    transactionDate,
  };
}

/**
 * The running balance on the most recent transaction. A consent raised for
 * TRANSACTIONS alone (what the sandbox product sends) gets no `summary`
 * block, so this is the only place a balance appears. FIPs do not send
 * transactions in date order — the live sandbox's are shuffled — so "the
 * last element" is not "the latest".
 */
function latestBalance(transactions: unknown[]): string | null {
  let latest: { at: number; balance: string } | null = null;
  for (const raw of transactions) {
    const balance = str(raw, "currentBalance");
    const timestamp = str(raw, "transactionTimestamp", "valueDate");
    const at = timestamp ? new Date(timestamp).getTime() : NaN;
    if (balance === null || Number.isNaN(at)) continue;
    if (!latest || at > latest.at) latest = { at, balance };
  }
  return latest?.balance ?? null;
}

export function parseDataSession(payload: unknown): ParsedDataSession {
  const accounts: ParsedAccountData[] = [];

  for (const fip of list(payload, "fips", "FIPs")) {
    const fipId = str(fip, "fipID", "fipId", "FIPID");
    if (!fipId) {
      console.warn("Skipping FIP block with no id in data session payload");
      continue;
    }

    for (const account of list(fip, "accounts", "Accounts")) {
      const linkRefNumber = str(account, "linkRefNumber", "linkReferenceNumber");
      if (!linkRefNumber) {
        console.warn("Skipping data-session account with no linkRefNumber", { fipId });
        continue;
      }

      const accountBody = field(field(account, "data"), "account", "Account");
      const summary = field(accountBody, "summary", "Summary");
      const transactionsBlock = field(accountBody, "transactions", "Transactions");

      const rawTransactions = list(transactionsBlock, "transaction", "Transaction");
      const transactions: ParsedTransaction[] = [];
      let skipped = 0;
      for (const raw of rawTransactions) {
        const parsed = parseTransaction(raw);
        if (parsed) transactions.push(parsed);
        else skipped += 1;
      }
      if (skipped > 0) {
        // Counted, not silent: a sync that quietly drops rows looks
        // identical to a bank with a quiet month.
        console.warn(`Skipped ${skipped} unparseable transaction(s) for ${fipId}/${linkRefNumber}`);
      }

      accounts.push({
        fipId,
        linkRefNumber,
        maskedAccountNumber: str(account, "maskedAccNumber", "maskedAccountNumber"),
        status: str(account, "FIstatus", "FIStatus", "status"),
        // Null when there is no summary, which is the sandbox's normal case.
        // That costs nothing: the consent's `accType` already carries the
        // fine SAVINGS/CURRENT, and ingest only uses this to correct it.
        accountType: str(summary, "type", "accType"),
        currentBalance: str(summary, "currentBalance") ?? latestBalance(rawTransactions),
        transactions,
      });
    }
  }

  return { status: str(payload, "status"), accounts };
}
