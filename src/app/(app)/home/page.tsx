import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getHomeData } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";
import { formatShortDate } from "@/lib/dates";
import { asCategoryIcon, asCategoryColor } from "@/lib/categories";
import { CategoryTile, DashedTile } from "@/components/transactions/CategoryTile";
import { CategoryStatRow } from "@/components/CategoryStatRow";
import { DonutChart } from "@/components/DonutChart";
import { BudgetPaceBar } from "@/components/budget/BudgetPaceBar";
import { PageHeader } from "@/components/ui/PageHeader";

// Home, top to bottom: greeting, the one number that answers "how am I
// doing", money in vs money out, shortcuts, the breakdown, the latest rows.
//
// The add-a-transaction button is no longer on this page — it is the raised
// button in the middle of the bottom bar now, so it works from every tab
// (components/nav/BottomNav.tsx).

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) return null; // layout already redirects; keeps TypeScript honest below

  const data = await getHomeData(user.id);
  const colors = Object.fromEntries(
    data.breakdown.map((row) => [row.categoryId ?? "uncategorized", `var(--color-${row.color})`]),
  );

  // Shares are computed off the same total the donut uses, which already
  // includes uncategorized spend — so these bars sum to the whole, with no
  // invisible gap (CONVENTIONS.md #4).
  const total = data.totalSpentThisMonth;
  const name = user.email.split("@")[0];
  const overBudget = data.budgetRemaining !== null && data.budgetRemaining < 0;
  // Only the top few belong on Home; the full list is what Analytics is for.
  const topCategories = data.breakdown.slice(0, 4);

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <PageHeader eyebrow={todayLabel()} title={greeting()} initial={name.charAt(0)} />

      {!data.hasLinkedAccounts ? (
        <Link
          href="/connect-bank"
          className="mb-5 flex items-center gap-3 rounded-card border border-dashed border-accent/40 bg-accent-soft p-4 text-sm font-semibold text-accent-soft-fg"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          Connect a bank account to see your spending
        </Link>
      ) : null}

      {/* The hero is a filled accent card — the one saturated surface in the
       * app, which is what makes the number on it the first thing read. */}
      <section
        className="mb-4 rounded-card p-5 text-white shadow-float"
        style={{
          backgroundImage:
            "linear-gradient(145deg, color-mix(in oklch, var(--color-accent) 84%, white), var(--color-accent))",
        }}
      >
        {data.budgetTotal !== null ? (
          <>
            {/* Past the budget, "left to spend" is always ₹0 and the bar is
              * always full — which reads as *finished*, not as *overspent*.
              * The headline switches to the overrun so the hero still
              * carries the one number worth knowing. */}
            <p className="text-[13px] font-medium text-white/75">
              {overBudget ? "Over budget this month" : "Left to spend this month"}
            </p>
            <p className="mb-4 mt-1 text-[34px] font-bold leading-none tracking-tight tnum">
              {formatCurrency(Math.abs(data.budgetRemaining ?? 0))}
            </p>
            <BudgetPaceBar spent={total} budget={data.budgetTotal} onAccent />
          </>
        ) : (
          <>
            <p className="text-[13px] font-medium text-white/75">Spent this month</p>
            <p className="mb-4 mt-1 text-[34px] font-bold leading-none tracking-tight tnum">
              {formatCurrency(total)}
            </p>
            <Link
              href="/budget"
              className="flex items-center justify-center gap-2 rounded-pill bg-white px-4 py-3 text-sm font-bold text-accent-soft-fg"
            >
              Set a budget for this month
            </Link>
          </>
        )}
      </section>

      {/* Money in beside money out — the pair the reference puts directly
       * under the hero, and the context the spend figure is missing on its
       * own. */}
      <section className="mb-5 grid grid-cols-2 gap-3">
        <StatTile
          label="Income"
          value={formatCurrency(data.totalIncomeThisMonth)}
          tone="success"
        />
        <StatTile label="Spent" value={formatCurrency(total)} tone="danger" />
      </section>

      <section className="mb-6 grid grid-cols-3 gap-3">
        <QuickAction href="/budget" label="Budget" icon={<WalletGlyph />} />
        <QuickAction href="/analytics" label="Analytics" icon={<ChartGlyph />} />
        <QuickAction href="/more/bill-scanner" label="Scan bill" icon={<ScanGlyph />} />
      </section>

      {total > 0 ? (
        <section className="mb-6 rounded-card bg-surface p-5 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-fg">Spending breakdown</h2>
            <Link href="/analytics" className="text-[13px] font-semibold text-accent">
              View all
            </Link>
          </div>

          <DonutChart
            donut={data.donut}
            colors={colors}
            centerLabel="Total spent"
            centerValue={formatCurrency(total)}
            size="lg"
          />

          <div className="mt-6 flex flex-col gap-4">
            {topCategories.map((row) => (
              <CategoryStatRow
                key={row.categoryId ?? "uncategorized"}
                icon={row.categoryId ? row.icon : null}
                color={row.categoryId ? row.color : null}
                name={row.name}
                caption={`${Math.round((row.amount / total) * 100)}%`}
                amount={formatCurrency(row.amount)}
                fraction={row.amount / total}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-fg">Recent transactions</h2>
          <Link href="/transactions" className="text-[13px] font-semibold text-accent">
            View all
          </Link>
        </div>

        {data.recentTransactions.length === 0 ? (
          <p className="rounded-card border border-dashed border-border p-6 text-center text-sm text-fg-muted">
            Nothing here yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.recentTransactions.map((tx) => (
              <Link
                key={tx.id}
                href={`/transactions/${tx.id}`}
                className="flex items-center gap-3 rounded-card bg-surface px-3.5 py-3 shadow-card"
              >
                {tx.category ? (
                  <CategoryTile
                    icon={asCategoryIcon(tx.category.icon)}
                    color={asCategoryColor(tx.category.color)}
                    size="sm"
                  />
                ) : (
                  <DashedTile size="sm" label="question" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold text-fg">
                    {tx.merchantName ?? tx.description}
                  </p>
                  <p className="text-[13px] font-medium text-fg-muted">
                    {formatShortDate(tx.transactionDate)}
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
        )}
      </section>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "danger";
}) {
  return (
    <div className="rounded-card bg-surface p-4 shadow-card">
      <div className="mb-2 flex items-center gap-2">
        <span
          className={`flex size-7 items-center justify-center rounded-full ${
            tone === "success" ? "bg-success/15 text-success-fg" : "bg-danger/15 text-danger-fg"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            {tone === "success" ? (
              <path d="M12 19V5M6 11l6-6 6 6" />
            ) : (
              <path d="M12 5v14M6 13l6 6 6-6" />
            )}
          </svg>
        </span>
        <span className="text-[13px] font-semibold text-fg-muted">{label}</span>
      </div>
      <p className="text-xl font-bold tracking-tight text-fg tnum">{value}</p>
    </div>
  );
}

function QuickAction({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 rounded-card bg-surface px-2 py-3.5 text-[12px] font-semibold text-fg shadow-card"
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-accent-soft-fg">
        {icon}
      </span>
      {label}
    </Link>
  );
}

// Inline stroke-SVG on the same 24px grid as everything else — never emoji
// (CONVENTIONS.md #3).
const GLYPH = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function WalletGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 15.5v-7Z" />
      <path d="M16 12h.01" />
    </svg>
  );
}

function ChartGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M4 20V10M12 20V4M20 20v-7" />
    </svg>
  );
}

function ScanGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M3.5 8.5v-3a2 2 0 0 1 2-2h3M15.5 3.5h3a2 2 0 0 1 2 2v3M20.5 15.5v3a2 2 0 0 1-2 2h-3M8.5 20.5h-3a2 2 0 0 1-2-2v-3" />
      <path d="M7.5 12h9" />
    </svg>
  );
}

// Greeting and date are rendered on the server, so both follow the server's
// clock rather than the reader's. That is fine for a date shown as context
// under a greeting, and it is the same clock every other number on this
// page is bucketed by (lib/dates.ts) — a client-side greeting would be the
// one thing on Home disagreeing with the rest.
function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
}
