import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Landing point for the magic link.
 *
 * Supabase sends one of two shapes depending on the project's email template:
 * a PKCE `code` to exchange, or a `token_hash` + `type` to verify. Both are
 * handled so the flow works whichever template the project is on.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Only allow same-origin relative paths, so the link cannot bounce a signed-in
  // user to another site.
  const requestedNext = searchParams.get("next") ?? "/";
  const next =
    requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/";

  const failure = (message: string) => {
    const url = new URL("/login", origin);
    url.searchParams.set("error", message);
    return NextResponse.redirect(url);
  };

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure(error.message);
    return NextResponse.redirect(new URL(next, origin));
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return failure(error.message);
    return NextResponse.redirect(new URL(next, origin));
  }

  return failure("That sign-in link is missing its token. Request a new one.");
}
