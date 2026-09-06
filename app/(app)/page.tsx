import Link from "next/link";

import { getCurrentUser } from "@/lib/supabase/server";
import { NAV_ITEMS } from "./nav";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">gazelle</h1>
        <p className="text-sm opacity-60">Signed in as {user?.email}</p>
      </div>

      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="text-sm underline underline-offset-4 opacity-70 hover:opacity-100"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>

      {/* The sidebar's sign-out is hidden on a phone, so repeat it here. */}
      <form action="/auth/sign-out" method="post" className="md:hidden">
        <button
          type="submit"
          className="text-sm underline underline-offset-4 opacity-60 hover:opacity-100"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
