import { describe, expect, it } from "vitest";
import { MemoryRepo } from "@/lib/db/memory-repo";
import { runChecks } from "@/lib/checks";
import { DemoProvider } from "@/lib/llm/demo";
import { LLMUnavailableError, type LLMProvider } from "@/lib/llm/types";
import { contactRecording } from "./__fixtures__/contact-run";
import { createRun, MAX_CONSECUTIVE_ERRORS, runStep, type EngineDeps } from "./run-step";

async function drive(deps: EngineDeps, runId: string, limit = 60) {
  const steps: string[] = [];
  for (let i = 0; i < limit; i++) {
    const out = await runStep(deps, runId);
    if (out.status === "busy") throw new Error("lease no liberado");
    steps.push(out.status === "error" ? `error:${out.step}` : out.step);
    if (!out.more) break;
  }
  return steps;
}

describe("full run in memory (Orchestrator → Develop ↔ Testing)", () => {
  it("plans, fails once, fixes, passes and integrates the contact page", async () => {
    const repo = new MemoryRepo();
    const deps = { repo, llm: new DemoProvider(contactRecording) };
    const run = await createRun(deps, { prompt: "añade una página de contacto a esta web", userId: null, mode: "demo" });

    const steps = await drive(deps, run.id);
    expect(steps).toEqual(["plan", "develop", "test", "develop", "test", "develop", "test", "integrate"]);

    const final = (await repo.getRun(run.id))!;
    expect(final).toMatchObject({ status: "done", currentVersion: 3, stepCount: 8 });
    const tasks = await repo.listTasks(run.id);
    expect(tasks.map((t) => [t.status, t.attempts])).toEqual([
      ["passed", 2],
      ["passed", 1],
    ]);

    // Testing's first report rejected the unlabelled email field, and Develop got that feedback.
    const firstReport = repo.reports[0];
    expect(firstReport.passed).toBe(false);
    expect(firstReport.failures.join(" ")).toMatch(/email no tiene <label>/);
    const feedback = repo.messages.find((m) => m.kind === "feedback")!;
    expect(feedback).toMatchObject({ from: "testing", to: "develop" });

    // The final site really contains the page, linked from every page, and passes all checks.
    const site = await repo.getFiles(run.id, 3);
    expect(Object.keys(site).sort()).toEqual(["contacto.html", "index.html", "nosotros.html", "styles.css"]);
    expect(runChecks(site).passed).toBe(true);
    expect(repo.messages.map((m) => m.kind)).toEqual([
      "assignment",
      "assignment",
      "delivery",
      "feedback",
      "delivery",
      "test_report",
      "delivery",
      "test_report",
      "summary",
    ]);
    expect(repo.events.filter((e) => e.type === "llm_call").every((e) => e.provider === "demo")).toBe(true);

    // A finished run does nothing more.
    expect(await runStep(deps, run.id)).toEqual({ status: "busy" });
  });

  it("closes a task as failed after 3 rejected attempts and finishes with failures", async () => {
    const bad = contactRecording["develop:1:1"];
    const recording = { ...contactRecording, "develop:1:2": bad, "develop:1:3": bad, "review:1:3": contactRecording["review:1:1"] };
    const repo = new MemoryRepo();
    const deps = { repo, llm: new DemoProvider(recording) };
    const run = await createRun(deps, { prompt: "añade una página de contacto", userId: null, mode: "demo" });

    await drive(deps, run.id);
    expect((await repo.getRun(run.id))!.status).toBe("done_with_failures");
    expect((await repo.listTasks(run.id)).map((t) => [t.status, t.attempts])).toEqual([
      ["failed", 3],
      ["passed", 1],
    ]);
  });

  it("decides with deterministic checks when the LLM review is missing", async () => {
    const { "review:1:2": _drop, ...recording } = contactRecording;
    const repo = new MemoryRepo();
    const deps = { repo, llm: new DemoProvider(recording) };
    const run = await createRun(deps, { prompt: "añade una página de contacto", userId: null, mode: "demo" });

    await drive(deps, run.id);
    expect((await repo.getRun(run.id))!.status).toBe("done");
    expect(repo.events.some((e) => e.message.startsWith("Revisión con LLM no disponible"))).toBe(true);
  });

  it("fails the run with a clear error when the LLM stays unavailable", async () => {
    const down: LLMProvider = {
      name: "gemini",
      generate: async () => {
        throw new LLMUnavailableError("429 cuota agotada");
      },
    };
    const repo = new MemoryRepo();
    const deps = { repo, llm: down };
    const run = await createRun(deps, { prompt: "añade una página de contacto", userId: null, mode: "live" });

    expect(await drive(deps, run.id)).toEqual(Array(MAX_CONSECUTIVE_ERRORS).fill("error:plan"));
    expect((await repo.getRun(run.id))!).toMatchObject({ status: "failed", error: expect.stringMatching(/no está disponible/) });
  });

  it("retries transient errors and gives up after the consecutive-error limit", async () => {
    const flaky: LLMProvider = {
      name: "gemini",
      generate: async () => {
        throw new Error("red caída");
      },
    };
    const repo = new MemoryRepo();
    const deps = { repo, llm: flaky };
    const run = await createRun(deps, { prompt: "añade una página de contacto", userId: null, mode: "live" });

    expect(await drive(deps, run.id)).toEqual(Array(MAX_CONSECUTIVE_ERRORS).fill("error:plan"));
    expect((await repo.getRun(run.id))!.status).toBe("failed");
  });

  it("lets only one concurrent step through the lease", async () => {
    const repo = new MemoryRepo();
    const deps = { repo, llm: new DemoProvider(contactRecording, 20) };
    const run = await createRun(deps, { prompt: "añade una página de contacto", userId: null, mode: "demo" });

    const outcomes = await Promise.all([runStep(deps, run.id), runStep(deps, run.id), runStep(deps, run.id)]);
    expect(outcomes.filter((o) => o.status === "busy")).toHaveLength(2);
    expect((await repo.listTasks(run.id))).toHaveLength(2);
  });
});
