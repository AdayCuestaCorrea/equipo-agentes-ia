import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase client bound to the visitor's session cookies (anon key, subject to RLS). */
export async function sessionClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only: the proxy refreshes them.
        }
      },
    },
  });
}

/** The signed-in user, verified with Supabase Auth (not just decoded from the cookie). */
export async function currentUser() {
  const supabase = await sessionClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
