"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/actions/auth";

const initialState: LoginState = {};

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="w-full max-w-sm space-y-4 text-left">
      <div>
        <label htmlFor="username" className="block text-sm text-ink-dim mb-1">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          required
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          className="w-full rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent"
          placeholder="Enter username"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm text-ink-dim mb-1">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent"
          placeholder="Enter password"
        />
      </div>

      {state?.error && (
        <div
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-accent text-surface px-4 py-3 text-sm font-medium hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Signing in…" : "Sign In"}
      </button>
    </form>
  );
}
