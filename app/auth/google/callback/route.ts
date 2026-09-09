import { NextResponse, type NextRequest } from "next/server";

import { GoogleSyncError } from "@/lib/google/errors";
import { verifyState } from "@/lib/google/oauth";
import { exchangeCode, fetchGoogleEmail, serverGoogleOAuthDeps } from "@/lib/google/oauth-server";
import { encryptSecret } from "@/lib/llm/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Landing point for Google's OAuth consent redirect (spec 08 item 4).
 * Mirrors app/auth/callback/route.ts's shape: a failure() helper that
 * redirects with a query-string message rather than throwing, so a
 * mid-flow problem lands the person back on /settings with a plain
 * explanation instead of an error page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const googleError = searchParams.get("error");

  const failure = (message: string) => {
    const url = new URL("/settings", origin);
    url.searchParams.set("google", "error");
    url.searchParams.set("message", message);
    return NextResponse.redirect(url);
  };

  // Google sends `error` instead of `code` when the person declines consent.
  if (googleError) return failure(`Google declined the connection: ${googleError}`);
  if (!code || !state) return failure("Google's redirect was missing its code or state.");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return failure("You were signed out before the connection finished. Sign in and try again.");
  }

  const hmacKey = process.env.ENCRYPTION_KEY;
  if (!hmacKey) return failure("Server is not configured: ENCRYPTION_KEY is missing.");

  // The CSRF guard signState/authorizeUrl set up: rejects a forged or
  // replayed callback before any code is ever exchanged.
  if (!verifyState(state, user.id, hmacKey)) {
    return failure("That connection link has expired or was not requested by you. Try again.");
  }

  try {
    const deps = serverGoogleOAuthDeps();
    const redirectUri = `${origin}/auth/google/callback`;
    const tokens = await exchangeCode(deps, code, redirectUri);
    const email = await fetchGoogleEmail(deps, tokens.accessToken);

    const { error } = await supabase.from("google_accounts").upsert(
      {
        user_id: user.id,
        email,
        access_token: encryptSecret(tokens.accessToken),
        refresh_token: encryptSecret(tokens.refreshToken),
        token_expires_at: tokens.expiresAt,
      },
      { onConflict: "user_id" },
    );
    if (error) return failure(`Could not save the connection: ${error.message}`);
  } catch (cause) {
    const message =
      cause instanceof GoogleSyncError || cause instanceof Error ? cause.message : String(cause);
    return failure(message);
  }

  const url = new URL("/settings", origin);
  url.searchParams.set("google", "connected");
  return NextResponse.redirect(url);
}
