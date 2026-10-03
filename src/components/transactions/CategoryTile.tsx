import { cn } from "@/lib/utils";
import type { CategoryIcon, CategoryColor } from "@/lib/categories";

// The one way a category ever renders — a rounded-square tile with a
// hand-drawn stroke-SVG icon. Never fall back to a plain colored dot or
// a letter avatar once this exists (CONVENTIONS.md #3): consistency across
// every screen is the entire point, which is also why the uncategorized
// state below gets its own DashedTile rather than silently reusing this
// one with muted colors.
//
// Two variants, one shape. "soft" is the default and what the target UI
// uses everywhere a tile sits in a list or a picker: a 16%-tinted ground
// with the category hue as the glyph color (.tile-soft in globals.css),
// which stays quiet next to bold amounts. "solid" keeps the saturated
// gradient chip for the rare spot that needs a tile to carry the emphasis
// on its own.

const SIZES = {
  sm: { tile: "size-10", icon: 19, radius: "rounded-[0.8rem]" },
  md: { tile: "size-11", icon: 22, radius: "rounded-[0.875rem]" },
  lg: { tile: "size-14", icon: 27, radius: "rounded-[1.05rem]" },
} as const;

type Size = keyof typeof SIZES;

// Inline stroke-SVG, one consistent 24px grid, currentColor — never emoji,
// never an icon font (CONVENTIONS.md #3).
//
// Two-tone on purpose: a translucent fill behind a solid stroke. A pure
// hairline outline disappears against a saturated tile at 18px, which is
// what made the first pass read as washed out; the fill gives the glyph a
// body to be recognised by, and it is currentColor at low alpha rather
// than a second hardcoded color so it keeps working on any tile hue.
const ICONS: Record<CategoryIcon, (props: { size: number }) => React.ReactNode> = {
  food: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4v5a2.5 2.5 0 0 0 2.5 2.5h0A2.5 2.5 0 0 0 9 9V4" fill="currentColor" fillOpacity="0.22" />
      <path d="M6.5 11.5V20" />
      <path d="M4 4v4M9 4v4" />
      <path d="M17.5 4c-1.6 1.4-2.5 3.4-2.5 5.6 0 1.6.9 2.6 2.5 2.9V20" fill="currentColor" fillOpacity="0.22" />
    </svg>
  ),
  transport: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 16v-3.2c0-.5.1-.9.4-1.3l2-3.1c.4-.6 1-.9 1.7-.9h8.8c.7 0 1.3.3 1.7.9l2 3.1c.3.4.4.8.4 1.3V16c0 .6-.4 1-1 1h-15c-.6 0-1-.4-1-1Z" fill="currentColor" fillOpacity="0.22" />
      <path d="M4 12.5h16" />
      <circle cx="7.5" cy="17" r="1.8" fill="currentColor" fillOpacity="0.35" />
      <circle cx="16.5" cy="17" r="1.8" fill="currentColor" fillOpacity="0.35" />
    </svg>
  ),
  shopping: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 8h13l-1.1 11.1a1 1 0 0 1-1 .9H7.6a1 1 0 0 1-1-.9L5.5 8Z" fill="currentColor" fillOpacity="0.22" />
      <path d="M9 10V6.5a3 3 0 0 1 6 0V10" />
    </svg>
  ),
  bills: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 3.5h13v17l-2.2-1.5-2.2 1.5-2.1-1.5L9.9 20.5 7.7 19l-2.2 1.5v-17Z" fill="currentColor" fillOpacity="0.22" />
      <path d="M9 8.5h6M9 12.5h6M9 16h3.5" />
    </svg>
  ),
  entertainment: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="5" width="19" height="13" rx="2.6" fill="currentColor" fillOpacity="0.22" />
      <path d="M10 9.3l4.4 2.7-4.4 2.7V9.3Z" fill="currentColor" fillOpacity="0.5" />
    </svg>
  ),
  other: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" fill="currentColor" fillOpacity="0.18" />
      <circle cx="8.2" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.8" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  ),
};

export interface CategoryTileProps {
  icon: CategoryIcon;
  color: CategoryColor;
  size?: Size;
  selected?: boolean;
  variant?: "soft" | "solid";
}

export function CategoryTile({
  icon,
  color,
  size = "md",
  selected = false,
  variant = "soft",
}: CategoryTileProps) {
  const { tile, icon: iconSize, radius } = SIZES[size];
  const Icon = ICONS[icon];

  return (
    <div className="relative inline-flex">
      <div
        className={cn(
          tile,
          radius,
          "flex shrink-0 items-center justify-center",
          variant === "soft" ? "tile-soft" : "text-white shadow-tile",
          selected && "ring-2 ring-accent ring-offset-2 ring-offset-surface",
        )}
        style={{
          // One custom property carries the hue for both variants: .tile-soft
          // mixes it against the surface, and the solid variant gradients it
          // against white. Either way the tile is derived from the single
          // category token rather than needing a hand-picked second shade.
          ["--tile-hue" as string]: `var(--color-${color})`,
          ...(variant === "solid"
            ? {
                // A flat fill looks pasted on; the solid tile gets a slight
                // top-light gradient so it reads as a physical chip.
                backgroundImage: `linear-gradient(160deg, color-mix(in oklch, var(--color-${color}) 82%, white), var(--color-${color}))`,
              }
            : null),
        }}
      >
        <Icon size={iconSize} />
      </div>
      {selected ? (
        <span className="absolute -right-1 -top-1 flex size-4.5 items-center justify-center rounded-full bg-accent text-accent-fg shadow-tile">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
      ) : null}
    </div>
  );
}

// "Uncategorized" and "add category" — the only two things that ever
// render as a dashed tile instead of a solid one.
export function DashedTile({ size = "md", label }: { size?: Size; label?: "plus" | "question" }) {
  const { tile, icon: iconSize, radius } = SIZES[size];

  return (
    <div
      className={cn(
        tile,
        radius,
        "flex shrink-0 items-center justify-center border-2 border-dashed border-border bg-surface-sunken text-fg-faint",
      )}
    >
      {label === "plus" ? (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      ) : (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5" />
          <path d="M12 17h.01" />
        </svg>
      )}
    </div>
  );
}
