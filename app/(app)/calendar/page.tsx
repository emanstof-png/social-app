import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/calendar` no longer exists as its own page (PRD §2.5 fix, 2026-09-08):
 * its month grid moved into `/feed` itself, so there is one merged view
 * instead of two. This route just forwards here, preserving `?month` for
 * anyone with an old link or bookmark.
 */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const params = await searchParams;
  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;
  redirect(monthParam ? `/feed?month=${monthParam}` : "/feed");
}
