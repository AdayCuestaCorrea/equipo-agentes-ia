import { developTask, orchestratorPlan, reviewDelivery, type CallMeta } from "@/lib/agents";
import { runChecks } from "@/lib/checks";
import type { ReviewOutput } from "@/lib/domain/schemas";
import { loadTemplate } from "@/lib/domain/template";
import type { Agent, RunMode, SiteFiles } from "@/lib/domain/types";
import { LLMUnavailableError, type LLMProvider } from "@/lib/llm/types";
import {
  afterDelivery,
  afterTest,
  decideNextStep,
  finalRunStatus,
  testVerdict,
  type Step,
  type TaskState,
} from "./machine";
import type { AgentState, Repo, RunRow, TaskRow } from "./repo";

export interface EngineDeps {
  repo: Repo;
  llm: LLMProvider;
  /** Website a new run starts from; defaults to demo-site/. */
  template?: SiteFiles;
}

/** Consecutive failing steps after which a run is closed instead of retried. */
export const MAX_CONSECUTIVE_ERRORS = 3;

export async function createRun(deps: EngineDeps, input: { prompt: string; userId: string | null; mode: RunMode }) {
  const run = await deps.repo.createRun(input);
  await deps.repo.saveVersion(run.id, 0, deps.template ?? loadTemplate(), { taskId: null, createdBy: "template" });
  await deps.repo.addEvent({
    runId: run.id,
    agent: "orchestrator",
    type: "info",
    message: `Petición recibida: «${input.prompt}»`,
  });
  return run;
}

export type StepOutcome =
  | { status: "busy" }
  | { status: "executed"; step: Step["type"]; more: boolean }
  | { status: "error"; step: Step["type"]; message: string; more: boolean };

const toTaskState = (t: TaskRow): TaskState => ({
  id: t.id,
  position: t.position,
  status: t.status,
  attempts: t.attempts,
  maxAttempts: t.maxAttempts,
});

/**
 * Executes exactly one step of a run (at most one or two LLM calls), so each serverless
 * invocation stays short. Safe to call concurrently: the DB lease lets only one through.
 */
export async function runStep(deps: EngineDeps, runId: string): Promise<StepOutcome> {
  const { repo } = deps;
  const run = await repo.claimRun(runId);
  if (!run) return { status: "busy" };

  let step: Step = { type: "none" };
  try {
    const tasks = await repo.listTasks(runId);
    step = decideNextStep({ status: run.status, stepCount: run.stepCount, tasks: tasks.map(toTaskState) });
    if (step.type === "none") return { status: "executed", step: "none", more: false };

    const ctx = new StepContext(deps, run, tasks);
    await ctx.execute(step);
    await repo.updateRun(runId, { stepCount: run.stepCount + 1, errorCount: 0 });
    return { status: "executed", step: step.type, more: !ctx.finished };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorCount = run.errorCount + 1;
    // LLM outages (503, per-minute 429) are usually transient: retried like any other error.
    const unavailable = err instanceof LLMUnavailableError;
    const giveUp = errorCount >= MAX_CONSECUTIVE_ERRORS;
    await repo.addEvent({
      runId,
      agent: agentFor(step),
      type: "error",
      message: giveUp ? `Error definitivo: ${message}` : `Error (se reintentará): ${message}`,
      data: { step: step.type, errorCount },
    });
    await repo.updateRun(runId, {
      stepCount: run.stepCount + 1,
      errorCount,
      ...(giveUp
        ? {
            status: "failed",
            finishedAt: new Date().toISOString(),
            error: unavailable ? `El LLM no está disponible (cuota agotada o caída): ${message}` : message,
          }
        : {}),
    });
    return { status: "error", step: step.type, message, more: !giveUp };
  } finally {
    await repo.releaseRun(runId);
  }
}

function agentFor(step: Step): Agent {
  if (step.type === "develop") return "develop";
  if (step.type === "test") return "testing";
  return "orchestrator";
}

class StepContext {
  finished = false;

  constructor(
    private readonly deps: EngineDeps,
    private readonly run: RunRow,
    private readonly tasks: TaskRow[],
  ) {}

  private get repo() {
    return this.deps.repo;
  }

  async execute(step: Step) {
    switch (step.type) {
      case "plan":
        return this.plan();
      case "develop":
        return this.develop(this.task(step.taskId));
      case "test":
        return this.test(this.task(step.taskId));
      case "integrate":
        return this.integrate();
      case "abort":
        return this.abort(step.reason);
      case "none":
        return;
    }
  }

  private task(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`Tarea ${id} no encontrada`);
    return t;
  }

  private state(agent: Agent, state: AgentState, message: string, taskId: string | null = null) {
    return this.repo.addEvent({ runId: this.run.id, taskId, agent, type: "state", message, data: { state } });
  }

  private llmEvent(agent: Agent, message: string, m: CallMeta, taskId: string | null, data?: unknown) {
    return this.repo.addEvent({
      runId: this.run.id,
      taskId,
      agent,
      type: "llm_call",
      message,
      data: { ...((data as object) ?? {}), fallback: m.fallback, usage: m.usage },
      provider: m.provider,
      model: m.model,
      latencyMs: m.latencyMs,
    });
  }

  private async plan() {
    const { repo, run } = this;
    await repo.updateRun(run.id, { status: "planning" });
    await this.state("orchestrator", "working", "Analizando la petición y la web actual");

    const files = await repo.getFiles(run.id, run.currentVersion);
    const { plan, warnings, meta } = await orchestratorPlan(this.deps.llm, { request: run.prompt, files });
    await this.llmEvent("orchestrator", `Plan creado: ${plan.tasks.length} tarea(s). ${plan.summary}`, meta, null, { plan });
    for (const w of warnings) await repo.addEvent({ runId: run.id, agent: "orchestrator", type: "info", message: w });

    const tasks = await repo.insertTasks(
      run.id,
      plan.tasks.map((t, i) => ({ position: i + 1, ...t })),
    );
    for (const t of tasks) {
      await repo.addMessage({
        runId: run.id,
        taskId: t.id,
        from: "orchestrator",
        to: "develop",
        kind: "assignment",
        body: { title: t.title, description: t.description, files: t.files, acceptance: t.acceptance },
      });
    }
    await repo.updateRun(run.id, { status: "running" });
    await this.state("orchestrator", "waiting", "Tareas repartidas; esperando a Develop y Testing");
  }

  private async develop(task: TaskRow) {
    const { repo, run } = this;
    const attempt = task.attempts + 1;
    await repo.updateTask(task.id, { status: "developing" });
    await this.state("develop", "working", `Tarea ${task.position}, intento ${attempt}/${task.maxAttempts}: ${task.title}`, task.id);

    const files = await repo.getFiles(run.id, run.currentVersion);
    const last = task.attempts > 0 ? await repo.lastTestReport(task.id) : null;
    const { output, meta } = await developTask(this.deps.llm, {
      request: run.prompt,
      task,
      attempt,
      files,
      feedback: last?.failures ?? [],
    });

    const version = run.currentVersion + 1;
    const next = { ...files, ...Object.fromEntries(output.files.map((f) => [f.path, f.content])) };
    await repo.saveVersion(run.id, version, next, { taskId: task.id, createdBy: "develop" });
    await repo.updateRun(run.id, { currentVersion: version });
    await repo.updateTask(task.id, afterDelivery(toTaskState(task)));

    const changed = output.files.map((f) => ({ path: f.path, isNew: !(f.path in files) }));
    await this.llmEvent("develop", `Entrega v${version}: ${output.summary}`, meta, task.id, { version, changed });
    await repo.addMessage({
      runId: run.id,
      taskId: task.id,
      from: "develop",
      to: "testing",
      kind: "delivery",
      body: { attempt, version, summary: output.summary, changed },
    });
    await this.state("develop", "waiting", `Entregada la v${version}; esperando a Testing`, task.id);
  }

  private async test(task: TaskRow) {
    const { repo, run } = this;
    await this.state("testing", "working", `Probando la tarea ${task.position} (intento ${task.attempts})`, task.id);

    const after = await repo.getFiles(run.id, run.currentVersion);
    // Tasks run sequentially and every attempt creates one version, so this is the site before the task.
    const before = await repo.getFiles(run.id, Math.max(0, run.currentVersion - task.attempts));
    const changed = Object.keys(after).filter((p) => before[p] !== after[p]);
    const report = runChecks(after, task.acceptance, { only: changed });
    const failedChecks = report.results.filter((r) => !r.passed);
    await repo.addEvent({
      runId: run.id,
      taskId: task.id,
      agent: "testing",
      type: "check",
      message: `Comprobaciones automáticas: ${report.results.length - failedChecks.length}/${report.results.length} superadas`,
      data: { results: report.results },
    });

    let review: ReviewOutput | null = null;
    try {
      const res = await reviewDelivery(this.deps.llm, {
        request: run.prompt,
        task,
        attempt: task.attempts,
        before,
        after,
        report,
      });
      review = res.review;
      await this.llmEvent("testing", `Revisión: ${review.verdict === "pass" ? "aprobada" : "con fallos"}. ${review.summary}`, res.meta, task.id, { review });
    } catch (err) {
      // The LLM review is a second opinion: if it is unavailable, deterministic checks decide.
      await repo.addEvent({
        runId: run.id,
        taskId: task.id,
        agent: "testing",
        type: "info",
        message: `Revisión con LLM no disponible; deciden las comprobaciones automáticas (${err instanceof Error ? err.message : err})`,
      });
    }

    const verdict = testVerdict(report, review);
    await repo.addTestReport({
      taskId: task.id,
      attempt: task.attempts,
      deterministic: report,
      llmReview: review,
      passed: verdict.passed,
      failures: verdict.failures,
    });
    const { status } = afterTest(toTaskState(task), verdict.passed);
    await repo.updateTask(task.id, { status });

    if (status === "fixing") {
      await repo.addMessage({
        runId: run.id,
        taskId: task.id,
        from: "testing",
        to: "develop",
        kind: "feedback",
        body: { attempt: task.attempts, failures: verdict.failures, remarks: verdict.remarks },
      });
      await this.state("testing", "waiting", `${verdict.failures.length} fallo(s) devueltos a Develop`, task.id);
    } else {
      await repo.addMessage({
        runId: run.id,
        taskId: task.id,
        from: "testing",
        to: "orchestrator",
        kind: "test_report",
        body: { attempt: task.attempts, passed: verdict.passed, failures: verdict.failures, remarks: verdict.remarks },
      });
      await this.state(
        "testing",
        "waiting",
        status === "passed"
          ? `Tarea ${task.position} superada`
          : `Tarea ${task.position} fallida tras ${task.attempts} intentos`,
        task.id,
      );
    }
  }

  private async integrate() {
    const { repo, run } = this;
    await repo.updateRun(run.id, { status: "integrating" });
    await this.state("orchestrator", "working", "Verificación final de toda la web");

    const files = await repo.getFiles(run.id, run.currentVersion);
    const report = runChecks(files);
    const tasks = await repo.listTasks(run.id);
    const status = finalRunStatus(tasks.map(toTaskState), report.passed);
    const passed = tasks.filter((t) => t.status === "passed").length;
    await repo.addEvent({
      runId: run.id,
      agent: "orchestrator",
      type: "check",
      message: `Integración: ${report.results.filter((r) => r.passed).length}/${report.results.length} comprobaciones globales superadas`,
      data: { results: report.results },
    });
    const summary =
      status === "done"
        ? `Petición completada: ${passed}/${tasks.length} tareas superadas en la v${run.currentVersion}.`
        : `Petición terminada con fallos: ${passed}/${tasks.length} tareas superadas${report.passed ? "" : "; la verificación final no pasa"}.`;
    await repo.addMessage({
      runId: run.id,
      from: "orchestrator",
      to: "orchestrator",
      kind: "summary",
      body: { summary, status, version: run.currentVersion },
    });
    await repo.updateRun(run.id, { status, finishedAt: new Date().toISOString() });
    for (const agent of ["orchestrator", "develop", "testing"] as const)
      await this.state(agent, "done", agent === "orchestrator" ? summary : "Trabajo terminado");
    this.finished = true;
  }

  private async abort(reason: string) {
    await this.repo.updateRun(this.run.id, { status: "failed", error: reason, finishedAt: new Date().toISOString() });
    await this.repo.addEvent({ runId: this.run.id, agent: "orchestrator", type: "error", message: `Ejecución detenida: ${reason}` });
    this.finished = true;
  }
}
