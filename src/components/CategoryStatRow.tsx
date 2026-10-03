import { asCategoryIcon, asCategoryColor } from "@/lib/categories";
import { CategoryTile, DashedTile } from "@/components/transactions/CategoryTile";

// The "Top Categories" row from the target UI, and the only way a category
// ever appears in a list: soft tile, name over a small caption, amount hard
// right, and a full-width track underneath carrying that category's share.
//
// Home, Analytics and Budget all draw this row. They used to each carry
// their own near-identical copy of it, which is how the three screens had
// already drifted to three different percentage roundings
// (CONVENTIONS.md #4). The differences that are real — what the caption
// says, whether the bar means "share of spend" or "share of budget", and
// whether an overrun turns it red — are props.

export function CategoryStatRow({
  icon,
  color,
  name,
  caption,
  amount,
  fraction,
  over = false,
}: {
  /** Untrusted strings straight off the database row; null renders the uncategorized tile. */
  icon: string | null;
  color: string | null;
  name: string;
  caption?: string;
  amount: React.ReactNode;
  /** 0-1. Clamped here so a category over its budget can't overflow the track. */
  fraction: number;
  /** Paints the bar with the danger token instead of the category hue. */
  over?: boolean;
}) {
  const categorized = icon !== null && color !== null;
  const width = `${Math.min(Math.max(fraction, 0), 1) * 100}%`;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        {categorized ? (
          <CategoryTile icon={asCategoryIcon(icon)} color={asCategoryColor(color)} size="md" />
        ) : (
          <DashedTile size="md" label="question" />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-fg">{name}</p>
          {caption ? (
            <p className="truncate text-[13px] font-medium text-fg-muted tnum">{caption}</p>
          ) : null}
        </div>

        <div className="shrink-0 text-right text-[15px] font-bold text-fg tnum">{amount}</div>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken">
        <div
          className="h-full rounded-pill"
          style={{
            width,
            // Over-budget wins over the category's own color: the whole
            // point of this bar is to make an overrun impossible to miss,
            // and a category hue that happens to be reddish shouldn't read
            // as alarming while a green one under-sells a real overspend.
            backgroundColor: over
              ? "var(--color-danger)"
              : categorized
                ? `var(--color-${asCategoryColor(color)})`
                : "var(--color-fg-faint)",
          }}
        />
      </div>
    </div>
  );
}
