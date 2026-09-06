import Link from "next/link";

import { getCurrentUser } from "@/lib/supabase/server";
import { Nav } from "./nav";

/**
 * The signed-in shell. proxy.ts already redirects signed-out users to /login,
 * so anything rendered under this layout can assume a user.
 *
 * Sidebar on desktop; on a phone the nav becomes a scrollable strip under the
 * header, since this is installed as a PWA on the home screen.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <header className="flex flex-col gap-3 border-b border-black/10 p-4 md:w-56 md:shrink-0 md:border-r md:border-b-0 dark:border-white/15">
        <Link href="/" className="px-3 text-lg font-semibold">
          gazelle
        </Link>

        <nav aria-label="Sections" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <Nav />
        </nav>

        <div className="mt-auto hidden flex-col gap-1 px-3 pt-4 md:flex">
          <p className="truncate text-xs opacity-60" title={user?.email ?? ""}>
            {user?.email}
          </p>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="text-xs underline underline-offset-4 opacity-60 hover:opacity-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-10">{children}</main>
    </div>
  );
}
