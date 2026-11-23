import { serviceClient } from "@/lib/db/supabase-repo";

/**
 * Daily ping so the Supabase free project is never paused for inactivity (it pauses after
 * one week). Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("No autorizado", { status: 401 });
  }
  const { count, error } = await serviceClient().from("runs").select("id", { count: "exact", head: true });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, runs: count, at: new Date().toISOString() });
}
