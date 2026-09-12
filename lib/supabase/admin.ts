import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only, service-role -- bypasses RLS. Only ever call from a route
 * with its own independent authorization check.
 *
 * Several scripts/ files already build a client from
 * SUPABASE_SERVICE_ROLE_KEY inline (e.g. scripts/setup-e2e-user.ts), for the
 * same reason: no user session to scope a query by. This is the first time
 * application route code (as opposed to a script or an e2e test) needs it,
 * so it gets one shared, named home instead of an inline client in the route
 * file (spec 09 item 5).
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are not set.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
