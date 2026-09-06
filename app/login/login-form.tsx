"use client";

import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "sending" });

    const callback = new URL("/auth/callback", window.location.origin);
    if (next !== "/") callback.searchParams.set("next", next);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback.toString() },
    });

    if (error) {
      setStatus({ kind: "error", message: error.message });
      return;
    }
    setStatus({ kind: "sent", email });
  }

  if (status.kind === "sent") {
    return (
      <div className="flex flex-col gap-2">
        <p className="font-medium">Check your email</p>
        <p className="text-sm opacity-70">
          A sign-in link is on its way to {status.email}. Open it on this device.
        </p>
        <button
          type="button"
          className="self-start text-sm underline underline-offset-4 opacity-70 hover:opacity-100"
          onClick={() => setStatus({ kind: "idle" })}
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="email" className="text-sm font-medium">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
        placeholder="you@example.com"
      />
      <button
        type="submit"
        disabled={status.kind === "sending"}
        className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {status.kind === "sending" ? "Sending…" : "Send magic link"}
      </button>
      {status.kind === "error" ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
