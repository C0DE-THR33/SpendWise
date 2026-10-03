import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { formatDayHeading } from "@/lib/dates";
import { asCategoryIcon, asCategoryColor, UNCATEGORIZED_LABEL } from "@/lib/categories";
import { CategoryTile, DashedTile } from "./CategoryTile";

// Rows link to /transactions/[id]. This used to be a Client Component that
// opened a categorize sheet on tap and held the resulting optimistic
// override in state; a row can only do one thing on tap, and now that a
// detail page exists, going there is the expected one. Categorizing moved
// with it (TransactionCategoryEditor), which also means one component
// writes categories instead of two.
//
// With no interaction state left, there is nothing for "use client" to buy
// (CONVENTIONS.md #4) — so this renders on the server like the page that
// holds it.
//
// Days are the reference's grouping: a "Today" / "Yesterday" heading with
// that day's net spend beside it, then the day's rows as separate cards
// rather than one divided block. The per-day total is the thing a divided
// block could never show, and it is what makes scrolling this list tell you
// something a single flat feed doesn't.

export interface TransactionRow {
  id: string;
  amount: number;
  direction: "DEBIT" | "CREDIT";
  description: string;
  merchantName: string | null;
  transactionDate: Date;
  category: { id: string; name: string; icon: string; color: string } | null;
}

export function TransactionsList({ transactions }: { transactions: TransactionRow[] }) {
  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium text-fg">No transactions yet</p>
        <p className="max-w-xs text-sm text-fg-muted">
          Connect a bank account, or add a cash transaction with the + button in the bar below.
        </p>
      </div>
    );
  }

  const grouped = groupByDay(transactions);

  return (
    <div className="flex flex-col gap-6">
      {grouped.map(([day, rows]) => {
        const spent = rows.reduce(
          (sum, tx) => sum + (tx.direction === "DEBIT" ? tx.amount : 0),
          0,
        );

        return (
          <div key={day} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between px-1">
              <h3 className="text-[15px] font-bold text-fg">{day}</h3>
              <span className="text-[13px] font-semibold text-fg-muted tnum">
                {formatCurrency(spent)}
              </span>
            </div>

            {rows.map((tx) => (
              <Link
                key={tx.id}
                href={`/transactions/${tx.id}`}
                className="flex w-full items-center gap-3 rounded-card bg-surface px-3.5 py-3 text-left shadow-card"
              >
                {tx.category ? (
                  <CategoryTile
                    icon={asCategoryIcon(tx.category.icon)}
                    color={asCategoryColor(tx.category.color)}
                    size="md"
                  />
                ) : (
                  <DashedTile size="md" label="question" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold text-fg">
                    {tx.merchantName ?? tx.description}
                  </p>
                  <p className="truncate text-[13px] font-medium text-fg-muted">
                    {tx.category?.name ?? UNCATEGORIZED_LABEL}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-[15px] font-bold tnum ${
                    tx.direction === "CREDIT" ? "text-success-fg" : "text-fg"
                  }`}
                >
                  {tx.direction === "CREDIT" ? "+" : "-"}
                  {formatCurrency(tx.amount)}
                </span>
              </Link>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function groupByDay(transactions: TransactionRow[]): [string, TransactionRow[]][] {
  const groups = new Map<string, TransactionRow[]>();
  for (const tx of transactions) {
    const key = formatDayHeading(tx.transactionDate);
    const existing = groups.get(key);
    if (existing) existing.push(tx);
    else groups.set(key, [tx]);
  }
  return Array.from(groups.entries());
}
