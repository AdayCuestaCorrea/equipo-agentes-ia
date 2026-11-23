"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "@/app/login/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, { error: null });
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-800">
        Correo
        <input name="email" type="email" autoComplete="username" required className="rounded-md border border-zinc-300 px-3 py-2 font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-800">
        Contraseña
        <input name="password" type="password" autoComplete="current-password" required className="rounded-md border border-zinc-300 px-3 py-2 font-normal" />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-60">
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
