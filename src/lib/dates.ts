// Pure date-bucketing helpers — no database, no browser, so they get a
// standalone verification script rather than being trusted on read
// (CONVENTIONS.md #8). See scripts run during development: month-boundary
// rollover across a year boundary is exactly the kind of edge case that's
// easy to get backwards with plain Date arithmetic.

export interface MonthKey {
  year: number;
  month: number; // 1-12
}

export function currentMonthKey(now: Date = new Date()): MonthKey {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** The [start, end) half-open range covering every millisecond of a given month. */
export function monthRange({ year, month }: MonthKey): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

/** Steps a MonthKey by `delta` months, correctly rolling over a year boundary either direction. */
export function shiftMonth({ year, month }: MonthKey, delta: number): MonthKey {
  const zeroBased = month - 1 + delta;
  const newYear = year + Math.floor(zeroBased / 12);
  const newMonth = ((zeroBased % 12) + 12) % 12;
  return { year: newYear, month: newMonth + 1 };
}

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatMonthLabel({ year, month }: MonthKey): string {
  return `${MONTH_LABELS[month - 1]} ${year}`;
}

export function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
}

/** Total days in a month, leap years included. */
export function daysInMonth({ year, month }: MonthKey): number {
  // Day 0 of the *next* month is the last day of this one, which sidesteps
  // needing a leap-year rule of our own.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Days left in the current month, counting today as one of them — the
 * denominator for "you can keep spending X a day".
 *
 * Counting today matters: on the last day of the month this returns 1, not
 * 0, so the caller divides by 1 rather than dividing by zero and rendering
 * an Infinity. The elapsed portion of today is deliberately ignored; a
 * daily allowance that shrank hour by hour would be unusable.
 */
export function daysRemainingInMonth(now: Date = new Date()): number {
  const total = daysInMonth(currentMonthKey(now));
  return total - now.getDate() + 1;
}

/** How far through the month we are, 0-1 — the "Today" marker's position. */
export function monthProgress(now: Date = new Date()): number {
  const total = daysInMonth(currentMonthKey(now));
  return (now.getDate() - 1) / total;
}

// ---------------------------------------------------------------------------
// Analytics ranges
// ---------------------------------------------------------------------------

/**
 * The four windows the Analytics segmented control offers. Everything that
 * reads spend takes a plain {start, end} half-open range already
 * (lib/queries.ts's getCategoryBreakdown), so a range is all a new window
 * costs — no per-window query.
 */
export const RANGE_KEYS = ["day", "week", "month", "year"] as const;

export type RangeKey = (typeof RANGE_KEYS)[number];

const RANGE_KEY_SET: ReadonlySet<string> = new Set(RANGE_KEYS);

/**
 * Narrows an untrusted value — this arrives as a `?range=` query string,
 * which anyone can type — to a RangeKey, falling back to the month view
 * rather than throwing on a URL a user could have edited by hand.
 */
export function asRangeKey(value: string | undefined | null): RangeKey {
  return value && RANGE_KEY_SET.has(value) ? (value as RangeKey) : "month";
}

export const RANGE_LABELS: Record<RangeKey, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
};

/**
 * The [start, end) range a RangeKey covers, in the same UTC-boundary terms
 * monthRange() uses so the two agree about which day a transaction lands in.
 *
 * "week" is a trailing 7 days rather than a calendar week on purpose: on a
 * Monday a calendar week would show a nearly empty chart, which reads as a
 * bug rather than as a fact about the calendar.
 */
export function rangeFor(key: RangeKey, now: Date = new Date()): { start: Date; end: Date } {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  switch (key) {
    case "day": {
      const start = new Date(Date.UTC(year, month, day));
      return { start, end: new Date(Date.UTC(year, month, day + 1)) };
    }
    case "week":
      return {
        start: new Date(Date.UTC(year, month, day - 6)),
        end: new Date(Date.UTC(year, month, day + 1)),
      };
    case "year":
      return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
    case "month":
    default:
      return monthRange(currentMonthKey(now));
  }
}

/** The subtitle under the Analytics heading — what window is on screen. */
export function formatRangeLabel(key: RangeKey, now: Date = new Date()): string {
  switch (key) {
    case "day":
      return "Today";
    case "week":
      return "Last 7 days";
    case "year":
      return String(now.getFullYear());
    case "month":
    default:
      return formatMonthLabel(currentMonthKey(now));
  }
}

/**
 * The heading over a day's transactions: "Today" and "Yesterday" by name,
 * anything older by date. Compared on local calendar days, which is how a
 * reader thinks about "today" — the UTC bucketing used for month ranges
 * would put a late-evening transaction under tomorrow's heading.
 */
export function formatDayHeading(date: Date, now: Date = new Date()): string {
  const days = Math.round(
    (startOfLocalDay(now).getTime() - startOfLocalDay(date).getTime()) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return formatShortDate(date);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
