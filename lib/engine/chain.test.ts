import { describe, expect, it, vi } from "vitest";
import { MemoryRepo } from "@/lib/db/memory-repo";
import { DemoProvider } from "@/lib/llm/demo";
import { contactRecording } from "./__fixtures__/contact-run";
import { runChain } from "./chain";
import { createRun } from "./run-step";

async function setup() {
  const repo = new MemoryRepo();
  const deps = { repo, llm: new DemoProvider(contactRecording) };
  const run = await createRun(deps, { prompt: "añade una página de contacto", userId: null, mode: "demo" });
  return { repo, deps, runId: run.id };
}

/** Fake clock: each step "takes" stepMs. */
function clock(stepMs: number) {
  let t = 0;
  return { now: () => (t += stepMs), sleep: async () => {} };
}

describe("runChain", () => {
  it("runs a whole short run in one invocation without any self-request", async () => {
    const { repo, deps, runId } = await setup();
    const handOff = vi.fn(async () => true);
    const outcomes = await runChain(deps, runId, { softBudgetMs: 60_000, retryPauseMs: 0, handOff, ...clock(1_000) });
    expect(outcomes).toHaveLength(8);
    expect(handOff).not.toHaveBeenCalled();
    expect((await repo.getRun(runId))!.status).toBe("done");
  });

  it("hands off to a new invocation once the soft budget is spent", async () => {
    const { repo, deps, runId } = await setup();
    const handOff = vi.fn(async () => true);
    const outcomes = await runChain(deps, runId, { softBudgetMs: 60_000, retryPauseMs: 0, handOff, ...clock(25_000) });
    // 25 s per step: after 3 steps (75 s) the 60 s soft budget is spent.
    expect(outcomes).toHaveLength(3);
    expect(handOff).toHaveBeenCalledOnce();
    expect((await repo.getRun(runId))!.status).toBe("running");
  });

  it("records a visible error when the hand-off fails (e.g. HTTP error)", async () => {
    const { repo, deps, runId } = await setup();
    await runChain(deps, runId, { softBudgetMs: 1, retryPauseMs: 0, handOff: async () => false, ...clock(10) });
    expect(repo.events.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/No se pudo encadenar/) });
  });

  it("records the error when the hand-off throws instead of ending silently", async () => {
    const { repo, deps, runId } = await setup();
    const handOff = async (): Promise<boolean> => {
      throw new Error("Falta STEP_SECRET");
    };
    await runChain(deps, runId, { softBudgetMs: 1, retryPauseMs: 0, handOff, ...clock(10) });
    expect(repo.events.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/No se pudo encadenar/) });
  });

  it("pauses before retrying a failed step", async () => {
    const { deps, runId } = await setup();
    const sleep = vi.fn(async () => {});
    const failing = { ...deps, llm: { name: "gemini" as const, generate: async () => Promise.reject(new Error("503")) } };
    await runChain(failing, runId, { softBudgetMs: 60_000, retryPauseMs: 20_000, handOff: async () => true, sleep, now: () => 0 });
    expect(sleep).toHaveBeenCalledWith(20_000);
  });
});
