import { after } from "next/server";
import { z } from "zod";
import { serviceClient } from "@/lib/db/supabase-repo";
import { createRun } from "@/lib/engine/run-step";
import { currentUser } from "@/lib/server/auth";
import { DEMO_PROMPT, engineDeps, isDemoPrompt, stepAndChain } from "@/lib/server/engine";

export const maxDuration = 300;

const Body = z.object({
  prompt: z.string().trim().min(3, "Escribe una petición").max(500, "Máximo 500 caracteres"),
  mode: z.enum(["live", "demo"]).default("live"),
});

/** Creates a run (signed-in users only) and starts its first step in the background. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Inicia sesión para lanzar peticiones" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { prompt } = parsed.data;
  const mode = process.env.DEMO_MODE === "true" ? "demo" : parsed.data.mode;

  if (mode === "demo" && !isDemoPrompt(prompt)) {
    return Response.json(
      { error: `El modo demo solo reproduce la petición de ejemplo: «${DEMO_PROMPT}»` },
      { status: 400 },
    );
  }

  if (mode === "live") {
    // Global daily cap protects the free LLM quota.
    const max = Number(process.env.MAX_LIVE_RUNS_PER_DAY ?? 20);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await serviceClient()
      .from("runs")
      .select("id", { count: "exact", head: true })
      .eq("mode", "live")
      .gte("created_at", since);
    if ((count ?? 0) >= max) {
      return Response.json(
        { error: `Se alcanzó el límite de ${max} ejecuciones en vivo por día. Prueba el modo demo.`, demoAvailable: true },
        { status: 429 },
      );
    }
  }

  const run = await createRun(engineDeps(mode), { prompt, userId: user.id, mode });
  const origin = new URL(request.url).origin;
  after(() => stepAndChain(origin, run.id, mode));
  return Response.json({ id: run.id }, { status: 201 });
}
