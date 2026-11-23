import demoRun from "@/fixtures/demo-run.json";
import { SupabaseRepo } from "@/lib/db/supabase-repo";
import type { RunMode } from "@/lib/domain/types";
import { runStep, type EngineDeps } from "@/lib/engine/run-step";
import { createLiveProvider } from "@/lib/llm";
import { DemoProvider } from "@/lib/llm/demo";

/** The request the demo recording answers; demo mode only replays this one. */
export const DEMO_PROMPT = demoRun.prompt;
/** Pause per replayed answer so the board animates like a live run. */
const DEMO_DELAY_MS = 1_500;

export function engineDeps(mode: RunMode): EngineDeps {
  return {
    repo: new SupabaseRepo(),
    llm: mode === "demo" ? new DemoProvider(demoRun.answers, DEMO_DELAY_MS) : createLiveProvider(),
  };
}

export const isDemoPrompt = (prompt: string) =>
  prompt.trim().toLowerCase().replace(/[.!¡]+$/, "") === DEMO_PROMPT.toLowerCase();

/** Fire-and-forget POST to the step endpoint, authenticated with STEP_SECRET. */
export async function triggerStep(origin: string, runId: string) {
  const secret = process.env.STEP_SECRET;
  if (!secret) throw new Error("Falta STEP_SECRET");
  try {
    await fetch(`${origin}/api/runs/${runId}/step`, {
      method: "POST",
      headers: { "x-step-secret": secret },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // The page's stale-run nudge (or the next visit) resumes the chain if this hop is lost.
    console.error(`No se pudo encadenar el paso de ${runId}:`, err);
  }
}

/** Runs one engine step and, if the run continues, schedules the next one in a fresh invocation. */
export async function stepAndChain(origin: string, runId: string, mode: RunMode) {
  const outcome = await runStep(engineDeps(mode), runId);
  if (outcome.status !== "busy" && outcome.more) await triggerStep(origin, runId);
  return outcome;
}
