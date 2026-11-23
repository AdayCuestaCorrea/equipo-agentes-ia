import { after } from "next/server";
import { serviceClient } from "@/lib/db/supabase-repo";
import { TERMINAL_RUN_STATUSES, type RunMode, type RunStatus } from "@/lib/domain/types";
import { stepAndChain } from "@/lib/server/engine";

/** One engine step (≤ one or two LLM calls with retries) must fit here; Vercel Hobby allows up to 300 s. */
export const maxDuration = 300;

/** Without the internal secret, a step may only be nudged if the run has been silent this long. */
const STALE_MS = 60_000;

export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/step">) {
  const { id } = await ctx.params;
  const db = serviceClient();
  const { data: run } = await db.from("runs").select("status, mode").eq("id", id).maybeSingle();
  if (!run) return Response.json({ error: "Ejecución no encontrada" }, { status: 404 });
  if (TERMINAL_RUN_STATUSES.includes(run.status as RunStatus)) return Response.json({ status: "finished" });

  const internal = !!process.env.STEP_SECRET && request.headers.get("x-step-secret") === process.env.STEP_SECRET;
  if (!internal) {
    // Public nudge from the run page: only when the chain looks lost.
    const { data: last } = await db
      .from("agent_events")
      .select("created_at")
      .eq("run_id", id)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    const silentFor = last ? Date.now() - new Date(last.created_at as string).getTime() : Infinity;
    if (silentFor < STALE_MS) return Response.json({ status: "running" }, { status: 202 });
  }

  const origin = new URL(request.url).origin;
  after(() => stepAndChain(origin, id, run.mode as RunMode));
  return Response.json({ status: "scheduled" }, { status: 202 });
}
