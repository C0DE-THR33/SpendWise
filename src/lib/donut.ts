// Pure donut-chart segment math for the spend-by-category breakdown (Home,
// Analytics). No DOM, no database — verified with a standalone script, not
// trusted on read (CONVENTIONS.md #8).
//
// Renders as a ring of SVG <circle> strokes: each segment gets a
// `strokeDasharray` (its arc length, then the rest of the circle) and a
// `strokeDashoffset` (where along the circle it starts), all stacked on
// one shared circumference so they tile with no gaps or overlaps.

export interface DonutInput {
  id: string;
  value: number; // already toNum()'d — never a Decimal
}

export interface DonutSegment {
  id: string;
  value: number;
  /** 0-100, rounded to one decimal place. */
  percentage: number;
  strokeDasharray: string;
  strokeDashoffset: number;
}

export interface DonutResult {
  segments: DonutSegment[];
  total: number;
}

/**
 * A percentage breakdown must account for spend that has no category, or
 * the percentages silently don't sum to 100% (CONVENTIONS.md #4). This
 * function doesn't know what "uncategorized" means — that's a query-layer
 * concern — it just requires the caller to pass every slice, uncategorized
 * included, as one more DonutInput. Zero-value and negative-total inputs
 * both degrade to an empty ring rather than dividing by zero.
 */
export function computeDonutSegments(
  items: DonutInput[],
): DonutResult {
  const circumference = 100;
  const total = items.reduce((sum, item) => sum + Math.max(item.value, 0), 0);

  if (total <= 0) {
    return { segments: [], total: 0 };
  }

  let offset = 0;
  const segments: DonutSegment[] = items
    .filter((item) => item.value > 0)
    .map((item) => {
      const fraction = item.value / total;
      const arcLength = fraction * circumference;
      const segment: DonutSegment = {
        id: item.id,
        value: item.value,
        percentage: Math.round(fraction * 1000) / 10,
        strokeDasharray: `${arcLength} ${circumference - arcLength}`,
        strokeDashoffset: -offset,
      };
      offset += arcLength;
      return segment;
    });

  return { segments, total };
}
