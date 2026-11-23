import type { CheckReport } from "@/lib/checks";
import type { ReviewOutput } from "@/lib/domain/schemas";
import { TERMINAL_RUN_STATUSES, type RunStatus, type TaskStatus } from "@/lib/domain/types";

/**
 * Pure orchestration logic. The engine persists state in the DB and calls
 * `decideNextStep` at the start of every short serverless invocation.
 */

/** Hard ceiling on engine steps per run, so a run can never loop forever (plan + 5 tasks × 3 × 2 + integrate + retries). */
export const MAX_STEPS = 50;

export interface TaskState {
  id: string;
  position: number;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
}

export interface RunState {
  status: RunStatus;
  stepCount: number;
  tasks: TaskState[];
}

export type Step =
  | { type: "plan" }
  | { type: "develop"; taskId: string }
  | { type: "test"; taskId: string }
  | { type: "integrate" }
  | { type: "abort"; reason: string }
  | { type: "none" };

const OPEN: readonly TaskStatus[] = ["pending", "developing", "testing", "fixing"];

export function decideNextStep(run: RunState): Step {
  if (TERMINAL_RUN_STATUSES.includes(run.status)) return { type: "none" };
  if (run.stepCount >= MAX_STEPS) return { type: "abort", reason: `Se superó el máximo de ${MAX_STEPS} pasos` };

  switch (run.status) {
    case "queued":
    case "planning":
      return { type: "plan" };
    case "integrating":
      return { type: "integrate" };
    case "running": {
      if (run.tasks.length === 0) return { type: "abort", reason: "El plan no tiene tareas" };
      const next = [...run.tasks].sort((a, b) => a.position - b.position).find((t) => OPEN.includes(t.status));
      if (!next) return { type: "integrate" };
      // "developing" means a previous develop step crashed mid-way: simply retry it.
      return next.status === "testing" ? { type: "test", taskId: next.id } : { type: "develop", taskId: next.id };
    }
  }
  return { type: "abort", reason: `Estado inesperado: ${run.status}` };
}

/** Task state after Develop delivers a version (an attempt counts once it is delivered). */
export function afterDelivery(task: TaskState): Pick<TaskState, "status" | "attempts"> {
  return { status: "testing", attempts: task.attempts + 1 };
}

/** Task state after Testing reports; failing on the last attempt closes the task as failed. */
export function afterTest(task: TaskState, passed: boolean): Pick<TaskState, "status"> {
  if (passed) return { status: "passed" };
  return { status: task.attempts >= task.maxAttempts ? "failed" : "fixing" };
}

export function finalRunStatus(tasks: TaskState[], integrationPassed: boolean): RunStatus {
  return integrationPassed && tasks.every((t) => t.status === "passed") ? "done" : "done_with_failures";
}

export interface Verdict {
  passed: boolean;
  /** What Develop must fix, in plain Spanish, ready to send as feedback. */
  failures: string[];
  /** Non-blocking remarks from the LLM review. */
  remarks: string[];
}

/**
 * Testing's verdict: every deterministic check must pass AND the LLM review must not
 * report blockers. If the review is unavailable (null), deterministic checks decide alone.
 */
export function testVerdict(report: CheckReport, review: ReviewOutput | null): Verdict {
  const failures = report.results
    .filter((r) => !r.passed)
    .flatMap((r) => r.details.map((d) => `${r.label}: ${d}`));
  const issues = review?.issues ?? [];
  const blockers = issues.filter((i) => i.severity === "blocker");
  for (const i of blockers) failures.push(`Revisión: ${i.file ? `${i.file}: ` : ""}${i.detail}`);
  // A "fail" verdict without itemised blockers still fails, using the reviewer's summary.
  if (review?.verdict === "fail" && blockers.length === 0) failures.push(`Revisión: ${review.summary}`);
  const remarks = issues.filter((i) => i.severity === "minor").map((i) => `${i.file ? `${i.file}: ` : ""}${i.detail}`);
  return { passed: failures.length === 0, failures, remarks };
}
