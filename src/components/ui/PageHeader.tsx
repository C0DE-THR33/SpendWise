import Link from "next/link";

// Every screen in the target UI opens the same way: a large bold title on
// the left, an optional line of context above it, and a round avatar button
// on the right. The avatar is this app's route to /more — with the bottom
// bar down to four tabs plus the add button, "More" needs a home, and the
// reference puts a profile affordance in exactly this spot.
//
// A component rather than a copied block per page (CONVENTIONS.md #4): the
// title size and the avatar's position are the two things that would drift
// first if each screen wrote its own header.

export function PageHeader({
  title,
  eyebrow,
  initial,
}: {
  title: string;
  eyebrow?: string;
  /** First letter of the signed-in user's email — the stand-in avatar. */
  initial?: string;
}) {
  return (
    <header className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-0.5 text-[13px] font-medium text-fg-muted">{eyebrow}</p>
        ) : null}
        <h1 className="truncate text-[28px] font-bold leading-tight tracking-tight text-fg">
          {title}
        </h1>
      </div>

      <Link
        href="/more"
        aria-label="Profile and more"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-bold text-accent-soft-fg shadow-card ring-1 ring-border"
      >
        {(initial ?? "?").toUpperCase()}
      </Link>
    </header>
  );
}

// The back-arrow header used by the screens that sit below a tab
// (transaction detail, the /more sub-pages). Same type scale as above so a
// pushed screen doesn't look like it came from a different app.
export function DetailHeader({
  title,
  backHref,
  backLabel = "Back",
}: {
  title: string;
  backHref: string;
  backLabel?: string;
}) {
  return (
    <header className="mb-5 flex items-center gap-3">
      <Link
        href={backHref}
        aria-label={backLabel}
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-fg shadow-card ring-1 ring-border"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 6-6 6 6 6" />
        </svg>
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight text-fg">{title}</h1>
      <span className="size-10 shrink-0" aria-hidden />
    </header>
  );
}
