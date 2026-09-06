import { getCurrentUser } from "@/lib/supabase/server";

export default async function HomePage() {
  // proxy.ts guarantees a signed-in user here; read it to prove the session works.
  const user = await getCurrentUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">gazelle</h1>
      <p className="text-sm opacity-70">Signed in as {user?.email}</p>
      <form action="/auth/sign-out" method="post">
        <button
          type="submit"
          className="text-sm underline underline-offset-4 opacity-70 hover:opacity-100"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
