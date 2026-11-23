import { runStep, type EngineDeps, type StepOutcome } from "./run-step";

export interface ChainOptions {
  /** Keep running steps in this invocation until this much time has passed, then hand off. */
  softBudgetMs: number;
  /** Wait after a failed step before retrying (free tiers rate-limit per minute). */
  retryPauseMs: number;
  /** Starts a fresh invocation that continues the run. Returns false if it could not be started. */
  handOff: () => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Runs consecutive engine steps inside one serverless invocation while the soft budget lasts,
 * and only then hands off to a new invocation. Few self-requests per run means Vercel's loop
 * protection (508 INFINITE_LOOP_DETECTED) is not tripped, which a request per step did in production.
 *
 * Budget: soft 60 s + one worst-case step (~200 s with provider retries) < 300 s Hobby limit.
 */
export async function runChain(deps: EngineDeps, runId: string, opts: ChainOptions): Promise<StepOutcome[]> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const started = now();
  const outcomes: StepOutcome[] = [];

  while (true) {
    const outcome = await runStep(deps, runId);
    outcomes.push(outcome);
    if (outcome.status === "busy" || !outcome.more) return outcomes;
    if (outcome.status === "error") await sleep(opts.retryPauseMs);
    if (now() - started >= opts.softBudgetMs) {
      if (!(await opts.handOff())) {
        await deps.repo.addEvent({
          runId,
          agent: "orchestrator",
          type: "error",
          message: "No se pudo encadenar el siguiente paso; se reanudará automáticamente en cuanto alguien abra la ejecución",
        });
      }
      return outcomes;
    }
  }
}
