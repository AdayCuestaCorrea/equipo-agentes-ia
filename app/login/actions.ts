"use server";

import { redirect } from "next/navigation";
import { sessionClient } from "@/lib/server/auth";

export type LoginState = { error: string | null };

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Escribe el correo y la contraseña" };
  const supabase = await sessionClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Correo o contraseña incorrectos" };
  redirect("/");
}

export async function signOut() {
  const supabase = await sessionClient();
  await supabase.auth.signOut();
  redirect("/");
}
