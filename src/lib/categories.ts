// Category.icon is a plain `string` column in Postgres — nothing in the
// database stops a bad value getting in — but the app only ever ships
// hand-drawn stroke-SVG icons for this closed set of six (see
// components/transactions/CategoryTile.tsx, and CONVENTIONS.md #4: "needs
// a runtime narrowing function at the read boundary, not a cast").

export const CATEGORY_ICONS = [
  "food",
  "transport",
  "shopping",
  "bills",
  "entertainment",
  "other",
] as const;

export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

/**
 * Narrows an untrusted `string` (fresh out of the database) to one of a
 * closed set. Never throws — an unexpected value is logged and mapped to the
 * fallback so one bad row can't crash a whole page render.
 */
function narrow<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  console.error(`Unexpected category value "${value}", falling back to "${fallback}"`);
  return fallback;
}

export function asCategoryIcon(value: string): CategoryIcon {
  return narrow(CATEGORY_ICONS, value, "other");
}

// Every color a category tile can use is one of these CSS custom-property
// names, mapped to real Tailwind utilities (bg-cat-food, etc.) in
// globals.css — see CONVENTIONS.md #3. Kept in sync with :root by hand.
export const CATEGORY_COLORS = [
  "cat-food",
  "cat-transport",
  "cat-shopping",
  "cat-bills",
  "cat-entertainment",
  "cat-other",
] as const;

export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export function asCategoryColor(value: string): CategoryColor {
  return narrow(CATEGORY_COLORS, value, "cat-other");
}

export const UNCATEGORIZED_LABEL = "Uncategorized";

/**
 * A category as the UI needs it — the shape every picker renders from.
 * Lives here rather than beside one component because three different
 * components take it as a prop, and a type owned by whichever component
 * happened to define it first is how import cycles start (#2: does it
 * return JSX? No → lib/).
 */
export interface CategoryOption {
  id: string;
  name: string;
  icon: string;
  color: string;
}
