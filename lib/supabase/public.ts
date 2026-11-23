import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let browser: SupabaseClient | undefined;

/** Browser client (anon key): reads public data under RLS and receives Realtime changes. */
export function browserClient(): SupabaseClient {
  browser ??= createBrowserClient(url(), anonKey());
  return browser;
}

/** Server-side anon client for public reads (no session, no service role). */
export function publicClient(): SupabaseClient {
  return createClient(url(), anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}
