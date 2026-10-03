import { daysRemainingInMonth, monthProgress } from "@/lib/dates";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

// Shared by Home and Budget — both answer "am I on track this month", so
// the bar and the arithmetic behind it live in one place rather than being
// duplicated per screen (CONVENTIONS.md #4).
//
// The point of the Today marker is that a progress bar alone can't tell you
// anything: 75% spent is healthy on the 25th and alarming on the 8th. The
// marker puts the month's own progress on the same axis, so "am I ahead of
// pace" becomes a thing you see rather than a thing you calculate.

export function BudgetPaceBar({
  spent,
  budget,
  now = new Date(),
  onAccent = false,
}: {
  spent: number;
  budget: number;
  now?: Date;
  /**
   * Render for the filled accent hero card on Home rather than a white
   * card. The tones below are semantic (danger / warn / accent), and none
   * of them is legible on a saturated violet ground — on the hero the bar
   * goes white and the state is carried by the caption underneath instead.
   */
  onAccent?: boolean;
}) {
  const remaining = budget - spent;
  const daysLeft = daysRemainingInMonth(now);
  const spentFraction = budget > 0 ? spent / budget : 0;
  const timeFraction = monthProgress(now);

  const overBudget = remaining < 0;
  // Ahead of pace only counts once you're meaningfully ahead — a couple of
  // percent either side of the marker is noise, not a warning.
  const aheadOfPace = !overBudget && spentFraction > timeFraction + 0.05;

  const tone = overBudget ? "danger" : aheadOfPace ? "warn" : "accent";
  const perDay = remaining > 0 ? remaining / daysLeft : 0;

  return (
    <div>
      <div className="relative">
        <div
          className={cn(
            "h-2.5 w-full overflow-hidden rounded-pill",
            onAccent ? "bg-white/25" : "bg-surface-sunken",
          )}
        >
          <div
            className={cn(
              "h-full rounded-pill transition-[width] duration-500",
              onAccent && "bg-white",
              !onAccent && tone === "danger" && "bg-danger",
              !onAccent && tone === "warn" && "bg-warn",
              !onAccent && tone === "accent" && "bg-accent",
            )}
            style={{ width: `${Math.min(spentFraction, 1) * 100}%` }}
          />
        </div>

        {/* The month's own progress, drawn over the bar. */}
        <div
          className={cn(
            "absolute -top-1 bottom-[-0.25rem] w-0.5 rounded-pill",
            onAccent ? "bg-white/70" : "bg-fg/45",
          )}
          style={{ left: `${timeFraction * 100}%` }}
          aria-hidden
        />
      </div>

      <div className="mt-2.5 flex items-baseline justify-between gap-3">
        <p className={cn("text-[13px]", onAccent ? "text-white/80" : "text-fg-muted")}>
          {overBudget ? (
            // On the hero the overrun is already the headline, so repeating
            // it here would print the same number twice; what's missing
            // there is what was spent against what was budgeted.
            onAccent ? (
              <>
                <span className="font-semibold text-white tnum">{formatCurrency(spent)}</span> of{" "}
                <span className="tnum">{formatCurrency(budget)}</span> spent
              </>
            ) : (
              <>
                <span className="font-semibold text-danger-fg tnum">
                  {formatCurrency(-remaining)}
                </span>{" "}
                over budget
              </>
            )
          ) : (
            <>
              <span className={cn("font-semibold tnum", onAccent ? "text-white" : "text-fg")}>
                {formatCurrency(perDay)}
              </span>{" "}
              a day for {daysLeft} more {daysLeft === 1 ? "day" : "days"}
            </>
          )}
        </p>
        <p
          className={cn(
            "shrink-0 text-[13px] font-semibold tnum",
            onAccent ? "text-white" : "text-fg-muted",
          )}
        >
          {Math.round(spentFraction * 100)}%
        </p>
      </div>

      {aheadOfPace ? (
        <p className={cn("mt-1.5 text-[13px]", onAccent ? "text-white/80" : "text-warn-fg")}>
          Spending faster than the month is passing.
        </p>
      ) : null}
    </div>
  );
}
