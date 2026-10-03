import { getCurrentUser } from "@/lib/auth";
import { getAnalyticsData } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";
import { formatMonthLabel, asRangeKey } from "@/lib/dates";
import { CategoryStatRow } from "@/components/CategoryStatRow";
import { DonutChart } from "@/components/DonutChart";
import { PageHeader } from "@/components/ui/PageHeader";
import { RangeTabs } from "@/components/ui/RangeTabs";

// Analytics, following the reference: the range control, one donut holding
// the total, then Top Categories. The six-month trend keeps its place at
// the bottom — it answers a different question from the donut ("is this
// month unusual"), so it stays fixed to months whatever the control says.

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;

  // Anyone can type ?range=whatever, so this is narrowed rather than cast,
  // falling back to the month view (CONVENTIONS.md #4).
  const rangeKey = asRangeKey((await searchParams).range);
  const data = await getAnalyticsData(user.id, rangeKey);
  const colors = Object.fromEntries(
    data.breakdown.map((row) => [row.categoryId ?? "uncategorized", `var(--color-${row.color})`]),
  );
  const maxTrend = Math.max(...data.trend.map((t) => t.total), 1);
  // The most recent bar is the month being viewed; highlighting it gives the
  // trend a "you are here" anchor instead of six interchangeable bars.
  const currentIndex = data.trend.length - 1;

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <PageHeader title="Analytics" initial={user.email.charAt(0)} />

      <RangeTabs active={rangeKey} basePath="/analytics" />

      {data.total > 0 ? (
        <>
          <section className="mb-6">
            <DonutChart
              donut={data.donut}
              colors={colors}
              centerLabel="Total spent"
              centerValue={formatCurrency(data.total)}
              size="lg"
            />
            <p className="mt-3 text-center text-[13px] font-medium text-fg-muted">
              {data.rangeLabel}
            </p>
          </section>

          <section className="mb-6">
            <h2 className="mb-4 text-[17px] font-bold tracking-tight text-fg">Top categories</h2>
            <div className="flex flex-col gap-5">
              {data.breakdown.map((row) => (
                <CategoryStatRow
                  key={row.categoryId ?? "uncategorized"}
                  icon={row.categoryId ? row.icon : null}
                  color={row.categoryId ? row.color : null}
                  name={row.name}
                  caption={`${Math.round((row.amount / data.total) * 100)}%`}
                  amount={formatCurrency(row.amount)}
                  fraction={row.amount / data.total}
                />
              ))}
            </div>
          </section>
        </>
      ) : (
        <p className="mb-6 rounded-card border border-dashed border-border p-8 text-center text-sm text-fg-muted">
          No spending recorded for {data.rangeLabel.toLowerCase()} yet.
        </p>
      )}

      <section className="rounded-card bg-surface p-5 shadow-card">
        <h2 className="mb-4 text-[15px] font-bold text-fg">6-month trend</h2>
        <div className="flex h-36 items-end justify-between gap-2">
          {data.trend.map((point, i) => {
            const isCurrent = i === currentIndex;
            return (
              <div
                key={`${point.monthKey.year}-${point.monthKey.month}`}
                className="flex flex-1 flex-col items-center gap-2"
              >
                <span
                  className={`text-[10px] font-semibold tnum ${
                    isCurrent ? "text-fg" : "text-fg-faint"
                  }`}
                >
                  {point.total > 0 ? Math.round(point.total / 1000) + "k" : ""}
                </span>
                <div className="flex h-24 w-full items-end">
                  <div
                    className={`w-full rounded-t-lg transition-[height] duration-500 ${
                      isCurrent ? "bg-accent" : "bg-accent/25"
                    }`}
                    style={{
                      height: `${Math.max((point.total / maxTrend) * 100, point.total > 0 ? 4 : 0)}%`,
                    }}
                  />
                </div>
                <span
                  className={`text-[10px] font-semibold ${
                    isCurrent ? "text-fg" : "text-fg-faint"
                  }`}
                >
                  {formatMonthLabel(point.monthKey).split(" ")[0].slice(0, 3)}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
