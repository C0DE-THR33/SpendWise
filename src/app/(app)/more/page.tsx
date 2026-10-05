import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { DetailHeader } from "@/components/ui/PageHeader";

// Inline stroke-SVG on the same 20px grid as the bottom nav, in a tinted
// tile — never emoji (CONVENTIONS.md #3). The first pass used emoji here,
// which renders as a different typeface per platform, ignores the color
// tokens entirely, and sat inconsistently beside the category tiles
// everywhere else in the app.
const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const LINKS = [
  {
    href: "/more/investments",
    label: "Investments",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3.5 17.5 9 11l4 3.5 7.5-8" />
        <path d="M15.5 6.5h5v5" />
      </svg>
    ),
  },
  {
    href: "/connect-bank",
    label: "Connect a bank account",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3.5 9.5 12 4l8.5 5.5" />
        <path d="M5.5 9.5v8M10 9.5v8M14 9.5v8M18.5 9.5v8" />
        <path d="M3 20.5h18" />
      </svg>
    ),
  },
  {
    href: "/more/settings",
    label: "Settings",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
      </svg>
    ),
  },
];

// Reached from the avatar in every screen's header rather than from a tab
// of its own — the bottom bar is four tabs plus the add button now
// (components/nav/BottomNav.tsx), so this is the app's profile screen and
// leads with who you are signed in as.
export default async function MorePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <DetailHeader title="Profile" backHref="/home" />

      <section className="mb-6 flex items-center gap-4 rounded-card bg-surface p-5 shadow-card">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xl font-bold text-accent-soft-fg">
          {user.email.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-fg">{user.email.split("@")[0]}</p>
          <p className="truncate text-[13px] font-medium text-fg-muted">{user.email}</p>
        </div>
      </section>

      <div className="mb-5 overflow-hidden rounded-card bg-surface shadow-card">
        {LINKS.map((link, i) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-3.5 px-4 py-4 text-[15px] font-semibold text-fg ${
              i > 0 ? "border-t border-border" : ""
            }`}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-tile bg-accent-soft text-accent-soft-fg">
              {link.icon}
            </span>
            <span className="flex-1">{link.label}</span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-fg-faint"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </Link>
        ))}
      </div>

      <SignOutButton />
    </div>
  );
}
