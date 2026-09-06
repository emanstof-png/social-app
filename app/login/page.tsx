import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in — gazelle",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const nextParam = Array.isArray(params.next) ? params.next[0] : params.next;
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/";
  const error = Array.isArray(params.error) ? params.error[0] : params.error;

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">gazelle</h1>
          <p className="text-sm opacity-70">Sign in with a link sent to your email.</p>
        </div>
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        ) : null}
        <LoginForm next={next} />
      </div>
    </main>
  );
}
