import { getCurrentUser } from "@/lib/auth";
import { getBudgetData } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";
import { formatMonthLabel } from "@/lib/dates";
import { asCategoryIcon, asCategoryColor } from "@/lib/categories";
import { CategoryTile } from "@/components/transactions/CategoryTile";
import { CategoryStatRow } from "@/components/CategoryStatRow";
import { BudgetPaceBar } from "@/components/budget/BudgetPaceBar";
import { PageHeader } from "@/components/ui/PageHeader";
import { setMonthlyBudget, setCategoryBudget } from "./actions";

export default async function BudgetPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const data = await getBudgetData(user.id);
  const budgetedCategoryIds = new Set(data.categories.map((c) => c.categoryId));
  const unbudgetedCategories = data.allCategories.filter((c) => !budgetedCategoryIds.has(c.id));
  const remaining = data.totalBudget === null ? null : data.totalBudget - data.totalSpent;

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <PageHeader
        eyebrow={formatMonthLabel(data.monthKey)}
        title="Budget"
        initial={user.email.charAt(0)}
      />

      <section className="mb-6 rounded-card bg-surface p-5 shadow-card">
        {data.totalBudget !== null ? (
          <>
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-fg-muted">Monthly budget</p>
                <p className="mt-0.5 text-[28px] font-bold leading-none tracking-tight text-fg tnum">
                  {formatCurrency(data.totalBudget)}
                </p>
              </div>
              <p className="text-right text-[13px] font-medium text-fg-muted">
                <span
                  className={`block text-[15px] font-bold tnum ${
                    (remaining ?? 0) < 0 ? "text-danger-fg" : "text-fg"
                  }`}
                >
                  {formatCurrency(Math.abs(remaining ?? 0))}
                </span>
                {(remaining ?? 0) < 0 ? "over" : "left"}
              </p>
            </div>
            <BudgetPaceBar spent={data.totalSpent} budget={data.totalBudget} />
          </>
        ) : (
          <p className="text-sm font-medium text-fg-muted">
            No budget set for {formatMonthLabel(data.monthKey)} yet.
          </p>
        )}

        <form action={setMonthlyBudget} className="mt-5 flex gap-2">
          <input
            type="number"
            name="totalAmount"
            step="0.01"
            min="0"
            required
            placeholder="Total monthly budget"
            defaultValue={data.totalBudget ?? undefined}
            className="tnum flex-1 rounded-pill border border-border bg-bg px-4 py-3 text-sm font-medium text-fg outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="rounded-pill bg-accent px-5 py-3 text-sm font-bold text-accent-fg"
          >
            Save
          </button>
        </form>
      </section>

      {data.categories.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-4 text-[17px] font-bold tracking-tight text-fg">By category</h2>
          <div className="flex flex-col gap-5">
            {data.categories.map((row) => {
              const over = row.budgeted > 0 && row.spent > row.budgeted;
              return (
                <CategoryStatRow
                  key={row.categoryId}
                  icon={row.icon}
                  color={row.color}
                  name={row.name}
                  caption={
                    over
                      ? `${formatCurrency(row.spent - row.budgeted)} over`
                      : `${formatCurrency(row.budgeted - row.spent)} left`
                  }
                  amount={
                    <>
                      <span className={over ? "text-danger-fg" : "text-fg"}>
                        {formatCurrency(row.spent)}
                      </span>
                      <span className="font-medium text-fg-muted">
                        {" / "}
                        {formatCurrency(row.budgeted)}
                      </span>
                    </>
                  }
                  fraction={row.budgeted > 0 ? row.spent / row.budgeted : 0}
                  over={over}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {unbudgetedCategories.length > 0 ? (
        <section>
          <h2 className="mb-4 text-[17px] font-bold tracking-tight text-fg">
            Add a category budget
          </h2>
          <div className="flex flex-col gap-2.5">
            {unbudgetedCategories.map((category) => (
              <form
                key={category.id}
                action={setCategoryBudget}
                className="flex items-center gap-3 rounded-card bg-surface p-3 shadow-card"
              >
                <input type="hidden" name="categoryId" value={category.id} />
                <CategoryTile
                  icon={asCategoryIcon(category.icon)}
                  color={asCategoryColor(category.color)}
                  size="sm"
                />
                {/* Three controls plus a name on a 375px screen is a tight
                  * row: at the list's usual weight, "Bills & Utilities" and
                  * "Entertainment" both truncate to an unreadable stub. The
                  * name drops to the body weight here and the amount field
                  * to its narrowest usable width so the full name fits. */}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                  {category.name}
                </span>
                <input
                  type="number"
                  name="amount"
                  step="0.01"
                  min="0"
                  required
                  // "Amount" no longer fits the narrowed field, and a
                  // clipped placeholder is worse than none — the aria-label
                  // carries the meaning for a screen reader either way.
                  placeholder="0"
                  aria-label={`Monthly budget for ${category.name}`}
                  className="tnum w-[4.5rem] shrink-0 rounded-pill border border-border bg-bg px-3 py-2 text-sm font-medium text-fg outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-pill bg-accent px-3 py-2 text-[13px] font-bold text-accent-fg"
                >
                  Add
                </button>
              </form>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
