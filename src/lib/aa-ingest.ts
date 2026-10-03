// The database-touching half of the Account Aggregator flow. lib/setu.ts
// talks to Setu and lib/setu-parse.ts normalises what comes back; this
// module is what turns that into LinkedAccount and Transaction rows.
//
// It exists as its own module because two callers need exactly the same
// work: the browser coming back from Setu's consent screens
// (/api/aa/consent/[id] and /api/aa/sync) and Setu's own webhook
// (/api/aa/webhook). Same split, same reason, as lib/auto-categorize.ts —
// neither path should grow its own copy (CONVENTIONS.md #4b).

import { AccountType, CategorySource, ConsentStatus, TransactionDirection } from "@prisma/client";
import { db } from "./db";
import { buildIconCategoryMap, pickCategoryId } from "./auto-categorize";
import { createDataSession, getConsent, getDataSession, type SetuConsentStatus } from "./setu";

/**
 * Setu's consent statuses onto ours. PENDING is deliberately absent: it is
 * the default a row is created with, and re-writing it on every poll would
 * only churn. REJECTED/FAILED map to REVOKED — from the app's side "the
 * user said no" and "the user took it back" are the same dead consent, and
 * inventing a REJECTED enum value would mean a migration for a state
 * nothing renders differently.
 */
function mapConsentStatus(status: SetuConsentStatus | string): ConsentStatus | null {
  switch (status) {
    case "ACTIVE":
      return ConsentStatus.ACTIVE;
    case "PAUSED":
      return ConsentStatus.PAUSED;
    case "REVOKED":
    case "REJECTED":
    case "FAILED":
      return ConsentStatus.REVOKED;
    case "EXPIRED":
      return ConsentStatus.EXPIRED;
    default:
      return null;
  }
}

/**
 * A FIP's account type string onto our enum. This is a closed set on our
 * side and an open one on the wire, so it gets a narrowing function at the
 * read boundary rather than a cast (CONVENTIONS.md #4) — an unfamiliar
 * value logs and falls back to SAVINGS instead of failing the whole link.
 *
 * DEPOSIT is the AA network's FIType for a bank account, which is what
 * comes through when a FIP does not send a finer-grained summary type.
 */
function mapAccountType(raw: string | null): AccountType {
  switch ((raw ?? "").toUpperCase()) {
    case "SAVINGS":
    case "DEPOSIT":
      return AccountType.SAVINGS;
    case "CURRENT":
      return AccountType.CURRENT;
    case "CREDIT_CARD":
    case "CREDIT-CARD":
      return AccountType.CREDIT_CARD;
    default:
      if (raw) console.warn(`Unrecognised FIP account type "${raw}", storing as SAVINGS`);
      return AccountType.SAVINGS;
  }
}

export interface LinkConsentResult {
  status: ConsentStatus;
  /** Accounts now on record for this consent, whether created just now or already there. */
  linkedAccountIds: string[];
}

/**
 * Reads a consent back from Setu and reconciles it into the database:
 * updates the stored status, and once the consent is ACTIVE, creates a
 * LinkedAccount row for each account the user picked.
 *
 * `userId` comes from the AaConsent row, never from the caller and never
 * from a payload — the consent id is the only thing Setu's redirect and
 * webhook carry, and neither is authenticated well enough to be trusted
 * with "whose account is this" (CONVENTIONS.md #5).
 */
export async function linkConsentAccounts(consentId: string): Promise<LinkConsentResult | null> {
  const stored = await db.aaConsent.findUnique({ where: { id: consentId } });
  if (!stored) return null;

  const consent = await getConsent(consentId);
  const status = mapConsentStatus(consent.status) ?? stored.status;

  await db.aaConsent.update({
    where: { id: consentId },
    data: { status, expiresAt: consent.consentExpiry ?? stored.expiresAt },
  });

  // A consent that is not active has no accounts to link — and if it was
  // active and has since been revoked, the accounts already on record
  // should stop claiming otherwise.
  if (status !== ConsentStatus.ACTIVE) {
    await db.linkedAccount.updateMany({ where: { consentId }, data: { consentStatus: status } });
    return { status, linkedAccountIds: [] };
  }

  const linkedAccountIds: string[] = [];

  for (const account of consent.accounts) {
    // findFirst + conditional create, not upsert: linkRefNumber is
    // nullable (the synthetic CASH account has none), and Postgres treats
    // every NULL as distinct, so ON CONFLICT would never fire and every
    // re-run would insert a duplicate (CONVENTIONS.md #6).
    //
    // Deliberately NOT scoped to consentId. linkRefNumber identifies the
    // account at the FIP, and it outlives the consent it was first linked
    // under — consents expire after twelve months and people reconnect. If
    // this matched on the consent too, every re-consent would miss and
    // create a second row for the same bank account, and the user's account
    // list would grow one phantom entry per reconnection. Worse, the
    // phantoms would never fill: ingest matches transactions on
    // [userId, linkRefNumber] alone, so it keeps writing to whichever row
    // came first while the newest one sits at zero forever. Verified by
    // running the flow twice against the mock gateway — two accounts became
    // four, and the two new rows stayed empty and unsynced.
    const existing = await db.linkedAccount.findFirst({
      where: { userId: stored.userId, linkRefNumber: account.linkRefNumber },
      select: { id: true },
    });

    if (existing) {
      await db.linkedAccount.update({
        where: { id: existing.id },
        // consentId moves to the consent that is now backing this link, so
        // the row tracks the live consent rather than the expired one it
        // was created under.
        data: { consentId, consentStatus: status, consentExpiresAt: consent.consentExpiry },
      });
      linkedAccountIds.push(existing.id);
      continue;
    }

    const created = await db.linkedAccount.create({
      data: {
        userId: stored.userId,
        fipId: account.fipId,
        // Sandbox FIPs do not always send a display name; the id is a
        // readable handle ("setu-fip"), so it beats an empty string.
        fipName: account.fipName ?? account.fipId,
        maskedAccountNumber: account.maskedAccountNumber,
        accountType: mapAccountType(account.accountType),
        consentId,
        linkRefNumber: account.linkRefNumber,
        consentStatus: status,
        consentExpiresAt: consent.consentExpiry,
      },
      select: { id: true },
    });
    linkedAccountIds.push(created.id);
  }

  await db.aaConsent.update({ where: { id: consentId }, data: { linkedAt: new Date() } });

  return { status, linkedAccountIds };
}

/** Starts a data fetch over the consent's own stored range. */
export async function startDataSession(consentId: string): Promise<{ dataSessionId: string; status: string } | null> {
  const stored = await db.aaConsent.findUnique({ where: { id: consentId } });
  if (!stored || stored.status !== ConsentStatus.ACTIVE) return null;

  return createDataSession({
    consentId,
    // Setu rejects a session whose range falls outside the consent's, so
    // this reuses the exact range the consent was raised with rather than
    // recomputing "the last N months" and drifting past the boundary.
    dataRange: { from: stored.dataRangeFrom, to: stored.dataRangeTo },
  });
}

/**
 * Rows per INSERT. Large enough that a year of statements is two or three
 * round trips rather than hundreds, small enough to stay well inside
 * Postgres' 65535-parameter ceiling at ~9 columns a row.
 */
const TRANSACTION_INSERT_CHUNK = 500;

export interface IngestResult {
  /** Combined session status from Setu: PENDING / PARTIAL / COMPLETED / … */
  status: string | null;
  synced: number;
  /** Accounts in the payload that matched no LinkedAccount row of this user's. */
  unmatchedAccounts: number;
}

/**
 * Pulls a data session and upserts its transactions.
 *
 * Idempotent by construction: [linkedAccountId, externalId] is a real
 * non-nullable compound unique, so re-running a sync over data already
 * stored no-ops those rows. `update` stays empty on purpose — a re-sync
 * must never clobber a category the user has since set by hand
 * (CONVENTIONS.md #4b, "never overwrite a human").
 */
export async function ingestDataSession(params: {
  userId: string;
  dataSessionId: string;
}): Promise<IngestResult> {
  const session = await getDataSession(params.dataSessionId);

  // Categorize on the way in, so a freshly synced statement is useful
  // immediately instead of arriving as a wall of "Uncategorized" the user
  // has to sort by hand (CONVENTIONS.md #1, "rules first"). Built once for
  // the whole batch, not per row.
  const iconCategories = await buildIconCategoryMap(params.userId);

  let synced = 0;
  let unmatchedAccounts = 0;

  for (const account of session.accounts) {
    // linkRefNumber is the join key, and the userId in this query is what
    // makes the whole ingest ownership-safe: a session id belonging to
    // someone else resolves to zero of this user's accounts and writes
    // nothing, rather than filing another person's statement under them.
    const linkedAccount = await db.linkedAccount.findFirst({
      where: { userId: params.userId, linkRefNumber: account.linkRefNumber },
      select: { id: true, accountType: true },
    });

    if (!linkedAccount) {
      unmatchedAccounts += 1;
      continue;
    }

    if (account.transactions.length > 0) {
      const rows = account.transactions.map((tx) => {
        // Setu's AA payload carries only a narration, no separate merchant
        // field — which is exactly the "UPI/DR/…/SWIGGY/…" shape the
        // categorization rules expect.
        const categoryId = pickCategoryId(iconCategories, { description: tx.description });

        return {
          linkedAccountId: linkedAccount.id,
          externalId: tx.externalId,
          amount: tx.amount,
          direction:
            tx.direction === "CREDIT" ? TransactionDirection.CREDIT : TransactionDirection.DEBIT,
          description: tx.description,
          mode: tx.mode,
          transactionDate: tx.transactionDate,
          categoryId,
          // Only claim a source when a rule actually fired — an unmatched
          // row stays honestly uncategorized (#4).
          categorySource: categoryId ? CategorySource.RULE : null,
        };
      });

      // createMany + skipDuplicates, not a $transaction of per-row upserts.
      // An upsert with an empty `update` *is* insert-if-absent, so this is
      // the same operation expressed as one `INSERT … ON CONFLICT DO
      // NOTHING` per chunk instead of one round trip per row — and it keeps
      // the same guarantee, since a conflicting row is left exactly as it
      // is and a category the user set by hand survives a re-sync
      // (CONVENTIONS.md #4b, "never overwrite a human").
      //
      // The old shape did not survive a real statement. A year of history
      // for one account is a few hundred rows, and several hundred
      // sequential round trips inside a single interactive transaction runs
      // past Supabase's statement timeout — Postgres 57014, "canceling
      // statement due to statement timeout", which rolls the whole account
      // back while the account before it stays committed. The failure looks
      // like a sync that hangs and then half-imports.
      for (let start = 0; start < rows.length; start += TRANSACTION_INSERT_CHUNK) {
        const { count } = await db.transaction.createMany({
          data: rows.slice(start, start + TRANSACTION_INSERT_CHUNK),
          skipDuplicates: true,
        });
        // Rows actually written, not rows offered: a re-sync of a statement
        // already stored should report 0, not claim it imported everything
        // a second time.
        synced += count;
      }
    }

    // Refresh the account type from the FIP's own summary, when there is one.
    // The live sandbox consent already reports the fine `accType`
    // (SAVINGS/CURRENT) alongside the coarse `fiType` DEPOSIT, and its data
    // sessions carry no summary, so there this is a no-op. It is kept for an
    // AA or FIP that only sends DEPOSIT on the consent — which mapAccountType
    // turns into SAVINGS — and does send a summary.
    const summaryType = account.accountType ? mapAccountType(account.accountType) : null;

    await db.linkedAccount.update({
      where: { id: linkedAccount.id },
      data: {
        lastSyncedAt: new Date(),
        ...(summaryType && summaryType !== linkedAccount.accountType
          ? { accountType: summaryType }
          : {}),
      },
    });
  }

  if (unmatchedAccounts > 0) {
    console.warn(
      `Data session ${params.dataSessionId}: ${unmatchedAccounts} account(s) matched no linked account`,
    );
  }

  return { status: session.status, synced, unmatchedAccounts };
}
