import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getCategoriesForUser } from "@/lib/queries";
import { SupabaseNotConfiguredError } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/NotConfigured";
import { BottomNav } from "@/components/nav/BottomNav";

// Every page under this group reads the signed-in user's own data on every
// request — statically optimizing or caching any of it would risk serving
// one user's numbers to the next request that hits the same route. Forcing
// dynamic rendering here, once, is simpler than remembering it per page.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user;

  try {
    user = await getCurrentUser();
  } catch (error) {
    if (error instanceof SupabaseNotConfiguredError) {
      return <NotConfigured />;
    }
    throw error;
  }

  // Defense in depth: src/proxy.ts already redirects unauthenticated
  // requests away from this route group, but a layout shouldn't assume
  // that's the only way it's ever reached.
  if (!user) {
    redirect("/login");
  }

  // The add button in the middle of the bottom bar opens the cash sheet
  // from every tab, so its category list is fetched once here rather than
  // by each page that used to render its own copy of the button.
  const categories = await getCategoriesForUser(user.id);

  // pb-28 clears the floating nav pill, which no longer sits flush against
  // the bottom edge: bar height plus the gap beneath it plus the safe area.
  return (
    <div className="min-h-screen bg-bg pb-[calc(7rem+env(safe-area-inset-bottom))]">
      {children}
      <BottomNav categories={categories} />
    </div>
  );
}
