import Link from "next/link";
import { cn } from "@/lib/utils";
import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/dates";

// The Day / Week / Month / Year control at the top of Analytics.
//
// Plain links over a client-side toggle: the numbers underneath come from
// the database, so every switch is a server round trip either way, and a
// <Link> keeps the whole control working as a set of real URLs — shareable,
// back-button-able, and rendered on the server like the page holding it
// (CONVENTIONS.md #4: "use client" has to buy something).

export function RangeTabs({ active, basePath }: { active: RangeKey; basePath: string }) {
  return (
    <div
      role="tablist"
      aria-label="Time range"
      className="mb-5 flex gap-1 rounded-pill bg-surface-sunken p-1"
    >
      {RANGE_KEYS.map((key) => {
        const selected = key === active;
        return (
          <Link
            key={key}
            href={`${basePath}?range=${key}`}
            role="tab"
            aria-selected={selected}
            className={cn(
              "flex-1 rounded-pill py-2 text-center text-[13px] font-semibold transition-colors",
              selected
                ? "bg-surface text-fg shadow-tile"
                : "text-fg-muted hover:text-fg",
            )}
          >
            {RANGE_LABELS[key]}
          </Link>
        );
      })}
    </div>
  );
}
