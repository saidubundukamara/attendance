"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { inputClass, Label } from "@/components/ui/field";
import { useShake } from "@/components/ui/use-shake";
import { login } from "@/lib/actions/auth";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  const shake = useShake<HTMLDivElement>(state);

  return (
    <form action={action} className="mt-10">
      <Label htmlFor="password">Password</Label>
      <div ref={shake}>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? "login-error" : undefined}
          className={`${inputClass} w-full`}
        />
      </div>
      {state?.error && (
        <p id="login-error" role="alert" className="mt-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        arrow
        block
        disabled={pending}
        className="mt-6"
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
