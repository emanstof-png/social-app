"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The eight sections of the app (spec 01, scope item 4). */
export const NAV_ITEMS = [
  { href: "/assessment", label: "Assessment" },
  { href: "/activities", label: "Activities" },
  { href: "/communities", label: "Communities" },
  { href: "/feed", label: "Feed" },
  { href: "/calendar", label: "Calendar" },
  { href: "/evaluations", label: "Evaluations" },
  { href: "/people", label: "People" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <ul className="flex gap-1 md:flex-col">
      {NAV_ITEMS.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href} className="shrink-0">
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`block rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                active
                  ? "bg-black/8 font-medium dark:bg-white/15"
                  : "opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
              }`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
