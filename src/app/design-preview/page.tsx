import { notFound } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { computeDonutSegments } from "@/lib/donut";
import { CategoryStatRow } from "@/components/CategoryStatRow";
import { DonutChart } from "@/components/DonutChart";
import { BudgetPaceBar } from "@/components/budget/BudgetPaceBar";
import { PageHeader } from "@/components/ui/PageHeader";
import { RangeTabs } from "@/components/ui/RangeTabs";
import { TransactionsList } from "@/components/transactions/TransactionsList";
import { BottomNav } from "@/components/nav/BottomNav";

// A dev-only harness for the screens' visual language, rendered from
// fixtures instead of the database.
//
// Why it exists: every real screen is behind Supabase auth and a Postgres
// query, so checking that a spacing or color change looks right otherwise
// means a working network, a signed-in session and seeded data. This page
// needs none of them — it is the fastest way to see the design system, and
// the only way to see it at all in an environment that can't reach the
// vendor.
//
// It is not a component library and nothing links to it: it holds one
// instance of each piece the app's screens are built from, in the order a
// screen stacks them. 404s outside development so it can never ship as a
// reachable route.

export default function DesignPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const breakdown = [
    { id: "food", name: "Food & Dining", icon: "food", color: "cat-food", amount: 4375 },
    { id: "transport", name: "Transport", icon: "transport", color: "cat-transport", amount: 3125 },
    { id: "shopping", name: "Shopping", icon: "shopping", color: "cat-shopping", amount: 3125 },
    { id: "fun", name: "Entertainment", icon: "entertainment", color: "cat-entertainment", amount: 1875 },
    { id: null, name: "Uncategorized", icon: null, color: null, amount: 500 },
  ];
  const total = breakdown.reduce((sum, row) => sum + row.amount, 0);
  const donut = computeDonutSegments(
    breakdown.map((row) => ({ id: row.id ?? "uncategorized", value: row.amount })),
  );
  const colors = Object.fromEntries(
    breakdown.map((row) => [row.id ?? "uncategorized", `var(--color-${row.color ?? "cat-other"})`]),
  );

  // One `now` for the whole fixture set, read once: the lint rule against
  // impure calls during render is right in general, and here it also keeps
  // every fixture row bucketed against the same instant.
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  const transactions = [
    {
      id: "t1",
      amount: 350,
      direction: "DEBIT" as const,
      description: "Lunch",
      merchantName: "Lunch",
      transactionDate: now,
      category: { id: "food", name: "Food & Dining", icon: "food", color: "cat-food" },
    },
    {
      id: "t2",
      amount: 180,
      direction: "DEBIT" as const,
      description: "Uber ride",
      merchantName: "Uber",
      transactionDate: now,
      category: { id: "transport", name: "Transport", icon: "transport", color: "cat-transport" },
    },
    {
      id: "t3",
      amount: 42000,
      direction: "CREDIT" as const,
      description: "Salary",
      merchantName: "Acme Payroll",
      transactionDate: yesterday,
      category: null,
    },
  ];

  return (
    <div className="min-h-screen bg-bg pb-24">
      <div className="mx-auto max-w-md px-4 pt-6">
        <PageHeader eyebrow="Saturday, 20 September" title="Good morning" initial="d" />

        <section
          className="mb-4 rounded-card p-5 text-white shadow-float"
          style={{
            backgroundImage:
              "linear-gradient(145deg, color-mix(in oklch, var(--color-accent) 84%, white), var(--color-accent))",
          }}
        >
          <p className="text-[13px] font-medium text-white/75">Left to spend this month</p>
          <p className="mb-4 mt-1 text-[34px] font-bold leading-none tracking-tight tnum">
            {formatCurrency(17000)}
          </p>
          <BudgetPaceBar spent={total} budget={30000} onAccent />
        </section>

        <section className="mb-6 rounded-card bg-surface p-5 shadow-card">
          <h2 className="mb-2 text-[15px] font-bold text-fg">Spending breakdown</h2>
          <DonutChart
            donut={donut}
            colors={colors}
            centerLabel="Total spent"
            centerValue={formatCurrency(total)}
            size="lg"
          />
          <div className="mt-6 flex flex-col gap-4">
            {breakdown.map((row) => (
              <CategoryStatRow
                key={row.id ?? "uncategorized"}
                icon={row.icon}
                color={row.color}
                name={row.name}
                caption={`${Math.round((row.amount / total) * 100)}%`}
                amount={formatCurrency(row.amount)}
                fraction={row.amount / total}
              />
            ))}
          </div>
        </section>

        <RangeTabs active="month" basePath="/design-preview" />

        <section className="mb-6">
          <h2 className="mb-4 text-[17px] font-bold tracking-tight text-fg">By category</h2>
          <div className="flex flex-col gap-5">
            <CategoryStatRow
              icon="food"
              color="cat-food"
              name="Food & Dining"
              caption={`${formatCurrency(625)} left`}
              amount={
                <>
                  <span className="text-fg">{formatCurrency(4375)}</span>
                  <span className="font-medium text-fg-muted"> / {formatCurrency(5000)}</span>
                </>
              }
              fraction={4375 / 5000}
            />
            <CategoryStatRow
              icon="shopping"
              color="cat-shopping"
              name="Shopping"
              caption={`${formatCurrency(1125)} over`}
              amount={
                <>
                  <span className="text-danger-fg">{formatCurrency(3125)}</span>
                  <span className="font-medium text-fg-muted"> / {formatCurrency(2000)}</span>
                </>
              }
              fraction={1}
              over
            />
          </div>
        </section>

        <TransactionsList transactions={transactions} />
      </div>

      <BottomNav
        categories={[
          { id: "food", name: "Food & Dining", icon: "food", color: "cat-food" },
          { id: "transport", name: "Transport", icon: "transport", color: "cat-transport" },
          { id: "shopping", name: "Shopping", icon: "shopping", color: "cat-shopping" },
          { id: "bills", name: "Bills", icon: "bills", color: "cat-bills" },
          { id: "fun", name: "Entertainment", icon: "entertainment", color: "cat-entertainment" },
          { id: "other", name: "Other", icon: "other", color: "cat-other" },
        ]}
      />
    </div>
  );
}
