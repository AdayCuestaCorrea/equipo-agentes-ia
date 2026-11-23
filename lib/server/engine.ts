import demoRun from "@/fixtures/demo-run.json";
import { SupabaseRepo } from "@/lib/db/supabase-repo";
import type { RunMode } from "@/lib/domain/types";
import { runChain } from "@/lib/engine/chain";
import type { EngineDeps } from "@/lib/engine/run-step";
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

/**
 * Starts a new invocation of the step endpoint, authenticated with STEP_SECRET.
 * Checks the answer (a 508 from Vercel's loop protection used to be lost silently) and retries once.
 */
export async function triggerStep(origin: string, runId: string): Promise<boolean> {
  const secret = process.env.STEP_SECRET;
  if (!secret) throw new Error("Falta STEP_SECRET");
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${origin}/api/runs/${runId}/step`, {
        method: "POST",
        headers: { "x-step-secret": secret },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return true;
      console.error(`Encadenar ${runId}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    } catch (err) {
      console.error(`Encadenar ${runId}: ${err instanceof Error ? err.message : err}`);
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

/** Soft time budget per invocation before handing off to a fresh one (see lib/engine/chain.ts). */
const SOFT_BUDGET_MS = 60_000;
/**
 * After a failed step, wait before retrying: free-tier limits are per minute (Groq 8K TPM),
 * so retrying instantly would burn the consecutive-error allowance in seconds.
 */
export const RETRY_PAUSE_MS = 20_000;

/** Runs as many steps as fit in this invocation, then continues in a fresh one if needed. */
export function stepAndChain(origin: string, runId: string, mode: RunMode) {
  return runChain(engineDeps(mode), runId, {
    softBudgetMs: SOFT_BUDGET_MS,
    retryPauseMs: RETRY_PAUSE_MS,
    handOff: () => triggerStep(origin, runId),
  });
}
