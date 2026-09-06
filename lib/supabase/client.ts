import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

/** Supabase client for Client Components. Reads the session from cookies. */
export function createSupabaseBrowserClient() {
  const env = publicEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
