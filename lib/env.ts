import { z } from "zod";

/**
 * Environment access. Fail loudly (CLAUDE.md): a missing or malformed variable
 * throws at first use with the variable name, rather than surfacing later as a
 * confusing Supabase error.
 *
 * NEXT_PUBLIC_* values must be referenced as literal `process.env.X` property
 * accesses so the bundler can inline them into the browser build.
 */

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cachedPublicEnv: PublicEnv | null = null;

export function publicEnv(): PublicEnv {
  if (cachedPublicEnv) return cachedPublicEnv;

  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `Missing or invalid environment variables: ${problems}. ` +
        `Set them in .env.local (local) and in the Vercel project settings (deployed).`,
    );
  }

  cachedPublicEnv = parsed.data;
  return cachedPublicEnv;
}
