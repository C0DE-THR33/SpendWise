import { db } from "@/lib/db";
import { toNum } from "@/lib/utils";
import { asCategoryIcon, asCategoryColor, UNCATEGORIZED_LABEL } from "@/lib/categories";
import { computeDonutSegments, type DonutResult } from "@/lib/donut";
import {
  currentMonthKey,
  monthRange,
  rangeFor,
  formatRangeLabel,
  type MonthKey,
  type RangeKey,
} from "@/lib/dates";
import { TransactionDirection, CategorySource, AccountType } from "@prisma/client";

// The entire query layer. One function per page's actual need, called
// directly from a Server Component — not a generic repository/DAO
// abstraction (CONVENTIONS.md #4). Shared logic between pages is a private
// helper below, not duplicated in each page's own function.

export interface CategoryBreakdownRow {
  categoryId: string | null;
  name: string;
  icon: ReturnType<typeof asCategoryIcon>;
  color: ReturnType<typeof asCategoryColor>;
  amount: number;
}

/**
 * This month's spend grouped by category, for one user — shared by
 * getHomeData and getAnalyticsData. Uncategorized spend gets its own row
 * (id `null`) rather than being dropped, so percentages always sum to 100%
 * (CONVENTIONS.md #4).
 */
async function getCategoryBreakdown(
  userId: string,
  range: { start: Date; end: Date },
): Promise<{ rows: CategoryBreakdownRow[]; donut: DonutResult; total: number }> {
  const grouped = await db.transaction.groupBy({
    by: ["categoryId"],
    where: {
      linkedAccount: { userId },
      direction: TransactionDirection.DEBIT,
      transactionDate: { gte: range.start, lt: range.end },
    },
    _sum: { amount: true },
  });

  const categoryIds = grouped.map((g) => g.categoryId).filter((id): id is string => id !== null);
  const categories = categoryIds.length
    ? await db.category.findMany({ where: { id: { in: categoryIds } } })
    : [];
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const rows: CategoryBreakdownRow[] = grouped.map((g) => {
    const amount = toNum(g._sum.amount);
    if (g.categoryId === null) {
      return { categoryId: null, name: UNCATEGORIZED_LABEL, icon: "other", color: "cat-other", amount };
    }
    const category = categoryById.get(g.categoryId);
    return {
      categoryId: g.categoryId,
      name: category?.name ?? UNCATEGORIZED_LABEL,
      icon: asCategoryIcon(category?.icon ?? "other"),
      color: asCategoryColor(category?.color ?? "cat-other"),
      amount,
    };
  });

  rows.sort((a, b) => b.amount - a.amount);

  const donut = computeDonutSegments(
    rows.map((r) => ({ id: r.categoryId ?? "uncategorized", value: r.amount })),
  );
  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  return { rows, donut, total };
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

export interface HomeTransactionRow {
  id: string;
  amount: number;
  direction: TransactionDirection;
  description: string;
  merchantName: string | null;
  transactionDate: Date;
  category: { id: string; name: string; icon: string; color: string } | null;
}

export interface HomeData {
  totalSpentThisMonth: number;
  totalIncomeThisMonth: number;
  budgetTotal: number | null;
  budgetRemaining: number | null;
  breakdown: CategoryBreakdownRow[];
  donut: DonutResult;
  recentTransactions: HomeTransactionRow[];
  hasLinkedAccounts: boolean;
}

async function getRecentTransactions(userId: string, take: number): Promise<HomeTransactionRow[]> {
  const rows = await db.transaction.findMany({
    where: { linkedAccount: { userId } },
    include: { category: true },
    orderBy: { transactionDate: "desc" },
    take,
  });

  // Decimal never leaves the query layer — converted here, not in the page.
  return rows.map((row) => ({ ...row, amount: toNum(row.amount) }));
}

export async function getHomeData(userId: string): Promise<HomeData> {
  const key = currentMonthKey();
  const range = monthRange(key);

  const [breakdownResult, income, budget, recentTransactions, linkedAccountCount] = await Promise.all([
    getCategoryBreakdown(userId, range),
    // The money-in half of the header pair. Credits are never part of the
    // spend breakdown (which filters to DEBIT), so this is its own
    // aggregate rather than something derivable from the rows above.
    db.transaction.aggregate({
      where: {
        linkedAccount: { userId },
        direction: TransactionDirection.CREDIT,
        transactionDate: { gte: range.start, lt: range.end },
      },
      _sum: { amount: true },
    }),
    db.monthlyBudget.findUnique({ where: { userId_year_month: { userId, year: key.year, month: key.month } } }),
    getRecentTransactions(userId, 8),
    // Excludes the synthetic CASH account (lib/cash.ts) on purpose:
    // adding one cash transaction must not make the app believe a bank is
    // connected and quietly retire the "Connect a bank account" prompt.
    db.linkedAccount.count({ where: { userId, NOT: { accountType: AccountType.CASH } } }),
  ]);

  const budgetTotal = budget ? toNum(budget.totalAmount) : null;

  return {
    totalSpentThisMonth: breakdownResult.total,
    totalIncomeThisMonth: toNum(income._sum.amount),
    budgetTotal,
    budgetRemaining: budgetTotal === null ? null : budgetTotal - breakdownResult.total,
    breakdown: breakdownResult.rows,
    donut: breakdownResult.donut,
    recentTransactions,
    hasLinkedAccounts: linkedAccountCount > 0,
  };
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export interface BudgetCategoryRow {
  categoryId: string;
  name: string;
  icon: ReturnType<typeof asCategoryIcon>;
  color: ReturnType<typeof asCategoryColor>;
  budgeted: number;
  spent: number;
}

export interface BudgetData {
  monthKey: MonthKey;
  totalBudget: number | null;
  totalSpent: number;
  categories: BudgetCategoryRow[];
  allCategories: Awaited<ReturnType<typeof getCategoriesForUser>>;
}

export async function getCategoriesForUser(userId: string) {
  return db.category.findMany({
    where: { OR: [{ userId: null }, { userId }] },
    orderBy: { name: "asc" },
  });
}

export async function getBudgetData(userId: string, monthKey: MonthKey = currentMonthKey()): Promise<BudgetData> {
  const range = monthRange(monthKey);

  const [monthlyBudget, breakdownResult, allCategories] = await Promise.all([
    db.monthlyBudget.findUnique({
      where: { userId_year_month: { userId, year: monthKey.year, month: monthKey.month } },
      include: { categoryBudgets: { include: { category: true } } },
    }),
    getCategoryBreakdown(userId, range),
    getCategoriesForUser(userId),
  ]);

  const spentByCategory = new Map(breakdownResult.rows.map((r) => [r.categoryId, r.amount]));

  const categories: BudgetCategoryRow[] = (monthlyBudget?.categoryBudgets ?? []).map((cb) => ({
    categoryId: cb.categoryId,
    name: cb.category.name,
    icon: asCategoryIcon(cb.category.icon),
    color: asCategoryColor(cb.category.color),
    budgeted: toNum(cb.amount),
    spent: spentByCategory.get(cb.categoryId) ?? 0,
  }));

  return {
    monthKey,
    totalBudget: monthlyBudget ? toNum(monthlyBudget.totalAmount) : null,
    totalSpent: breakdownResult.total,
    categories,
    allCategories,
  };
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface MonthlyTrendPoint {
  monthKey: MonthKey;
  total: number;
}

export interface AnalyticsData {
  monthKey: MonthKey;
  rangeKey: RangeKey;
  rangeLabel: string;
  breakdown: CategoryBreakdownRow[];
  donut: DonutResult;
  total: number;
  trend: MonthlyTrendPoint[];
}

/**
 * The donut and the category list follow the segmented control's window
 * (day / week / month / year); the trend strip below them is always the
 * trailing six months, because a six-bar month history is what it is for —
 * re-scoping it to "the last 7 days" would make it a different chart.
 */
export async function getAnalyticsData(
  userId: string,
  rangeKey: RangeKey = "month",
  now: Date = new Date(),
): Promise<AnalyticsData> {
  const monthKey = currentMonthKey(now);
  const range = rangeFor(rangeKey, now);
  const breakdownResult = await getCategoryBreakdown(userId, range);

  // Trailing 6 months, oldest first, for the trend strip.
  const trendKeys: MonthKey[] = [];
  for (let i = 5; i >= 0; i--) {
    const zeroBased = monthKey.month - 1 - i;
    const year = monthKey.year + Math.floor(zeroBased / 12);
    const month = ((zeroBased % 12) + 12) % 12;
    trendKeys.push({ year, month: month + 1 });
  }

  const trend = await Promise.all(
    trendKeys.map(async (key) => {
      const { start, end } = monthRange(key);
      const result = await db.transaction.aggregate({
        where: {
          linkedAccount: { userId },
          direction: TransactionDirection.DEBIT,
          transactionDate: { gte: start, lt: end },
        },
        _sum: { amount: true },
      });
      return { monthKey: key, total: toNum(result._sum.amount) };
    }),
  );

  return {
    monthKey,
    rangeKey,
    rangeLabel: formatRangeLabel(rangeKey, now),
    breakdown: breakdownResult.rows,
    donut: breakdownResult.donut,
    total: breakdownResult.total,
    trend,
  };
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export async function getTransactionsData(userId: string): Promise<HomeTransactionRow[]> {
  const rows = await db.transaction.findMany({
    where: { linkedAccount: { userId } },
    include: { category: true },
    orderBy: { transactionDate: "desc" },
  });

  return rows.map((row) => ({ ...row, amount: toNum(row.amount) }));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettingsData(userId: string) {
  const [user, linkedAccounts] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.linkedAccount.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);

  return { user, linkedAccounts };
}

// ---------------------------------------------------------------------------
// Investments
// ---------------------------------------------------------------------------

export async function getInvestmentsData(userId: string) {
  const investments = await db.investment.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const totalInvested = investments.reduce((sum, i) => sum + toNum(i.investedAmount), 0);
  const totalCurrent = investments.reduce((sum, i) => sum + toNum(i.currentValue), 0);

  return {
    investments: investments.map((i) => ({
      ...i,
      investedAmount: toNum(i.investedAmount),
      currentValue: toNum(i.currentValue),
    })),
    totalInvested,
    totalCurrent,
    totalGain: totalCurrent - totalInvested,
  };
}

// ---------------------------------------------------------------------------
// Transaction detail
// ---------------------------------------------------------------------------

export interface TransactionDetail {
  id: string;
  amount: number;
  direction: TransactionDirection;
  description: string;
  merchantName: string | null;
  mode: string | null;
  transactionDate: Date;
  categorySource: CategorySource | null;
  category: { id: string; name: string; icon: string; color: string } | null;
  account: { fipName: string; maskedAccountNumber: string; isCash: boolean };
}

/**
 * One transaction, for its detail page.
 *
 * The userId in the where clause is the ownership check, not a filter for
 * convenience: a Transaction reaches its owner only via
 * linkedAccount.userId (CONVENTIONS.md #5). Fetching by id alone and
 * checking afterwards would still have leaked the row into this process;
 * scoping the query means a transaction that isn't yours is simply not
 * found, and the page renders notFound().
 */
export async function getTransactionDetail(
  userId: string,
  transactionId: string,
): Promise<TransactionDetail | null> {
  const row = await db.transaction.findFirst({
    where: { id: transactionId, linkedAccount: { userId } },
    include: { category: true, linkedAccount: true },
  });

  if (!row) return null;

  return {
    id: row.id,
    amount: toNum(row.amount),
    direction: row.direction,
    description: row.description,
    merchantName: row.merchantName,
    mode: row.mode,
    transactionDate: row.transactionDate,
    categorySource: row.categorySource,
    category: row.category
      ? {
          id: row.category.id,
          name: row.category.name,
          icon: row.category.icon,
          color: row.category.color,
        }
      : null,
    account: {
      fipName: row.linkedAccount.fipName,
      maskedAccountNumber: row.linkedAccount.maskedAccountNumber,
      isCash: row.linkedAccount.accountType === AccountType.CASH,
    },
  };
}
