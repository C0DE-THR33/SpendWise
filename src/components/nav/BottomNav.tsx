"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { CategoryOption } from "@/lib/categories";
import { AddCashSheet } from "@/components/transactions/AddCashSheet";

// The target UI's bottom bar: a dark floating pill with four tabs and a
// raised round add button through its middle.
//
// Two consequences of that shape, both deliberate:
//
//   - Four tabs, not five. The add button takes the centre slot, so "More"
//     moved to the avatar in PageHeader. /more is still a route like any
//     other; it just isn't a tab.
//   - The add button lives here rather than on Home. It used to be a
//     floating button Home alone rendered, which meant adding a cash
//     transaction was impossible from the three screens where you are most
//     likely to notice one missing. The sheet it opens is unchanged.
//
// Labels render for the active tab only, as in the reference — at this size
// four labels of 11px text under four icons is noise, and the highlighted
// one is the only one that's telling you something you don't know.

const TABS = [
  { href: "/home", label: "Home", icon: HomeIcon },
  { href: "/transactions", label: "Activity", icon: ListIcon },
  { href: "/budget", label: "Budget", icon: WalletIcon },
  { href: "/analytics", label: "Analytics", icon: ChartIcon },
] as const;

export function BottomNav({ categories }: { categories: CategoryOption[] }) {
  const pathname = usePathname();
  const [adding, setAdding] = useState(false);

  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-20 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <nav className="relative mx-auto max-w-md rounded-[1.75rem] bg-nav px-2 shadow-float">
          <div className="flex items-stretch">
            <div className="flex flex-1 items-stretch">
              {left.map((tab) => (
                <Tab key={tab.href} {...tab} pathname={pathname} />
              ))}
            </div>

            {/* The add button's footprint inside the bar. The button itself
             * is absolutely positioned so it can rise above the pill
             * without the flex row growing to fit it. */}
            <div className="w-16 shrink-0" aria-hidden />

            <div className="flex flex-1 items-stretch">
              {right.map((tab) => (
                <Tab key={tab.href} {...tab} pathname={pathname} />
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label="Add a cash transaction"
            className="absolute left-1/2 top-0 flex size-14 -translate-x-1/2 -translate-y-1/3 items-center justify-center rounded-full bg-accent text-accent-fg shadow-float ring-4 ring-bg transition-transform active:scale-95"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </nav>
      </div>

      {adding ? (
        <AddCashSheet categories={categories} onClose={() => setAdding(false)} />
      ) : null}
    </>
  );
}

function Tab({
  href,
  label,
  icon: Icon,
  pathname,
}: {
  href: string;
  label: string;
  icon: (props: { active: boolean }) => React.ReactNode;
  pathname: string;
}) {
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 py-3.5 text-[11px] font-semibold transition-colors",
        active ? "text-accent" : "text-nav-fg-muted",
      )}
    >
      <Icon active={active} />
      {active ? <span>{label}</span> : null}
    </Link>
  );
}

// Inline stroke-SVG, 22px grid, currentColor — matches the icon-tile
// system's rules even though nav icons aren't category tiles
// (CONVENTIONS.md #3).
function iconProps(active: boolean) {
  return {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: active ? 2.25 : 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9h12v-9" />
    </svg>
  );
}

function ListIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

function WalletIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5v-7Z" />
      <path d="M16 12h.01" />
    </svg>
  );
}

function ChartIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M12 3a9 9 0 1 0 9 9h-9V3Z" />
      <path d="M15 3.6A9 9 0 0 1 20.4 9H15V3.6Z" />
    </svg>
  );
}
