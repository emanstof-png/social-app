import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next 16 renamed the `middleware` file convention to `proxy`; behaviour is
 * unchanged. Refreshes the Supabase session and redirects signed-out users to
 * /login.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every path except Next internals, the service worker, the manifest and
     * static asset files. Keeping those out means an unauthenticated browser
     * can still install the PWA and load the offline shell.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
