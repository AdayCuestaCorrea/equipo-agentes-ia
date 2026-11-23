import { describe, expect, it } from "vitest";
import type { CheckReport } from "@/lib/checks";
import type { ReviewOutput } from "@/lib/domain/schemas";
import type { TaskStatus } from "@/lib/domain/types";
import {
  afterDelivery,
  afterTest,
  decideNextStep,
  finalRunStatus,
  MAX_STEPS,
  testVerdict,
  type RunState,
  type TaskState,
} from "./machine";

const task = (position: number, status: TaskStatus, attempts = 0): TaskState => ({
  id: `t${position}`,
  position,
  status,
  attempts,
  maxAttempts: 3,
});
const run = (status: RunState["status"], tasks: TaskState[] = [], stepCount = 0): RunState => ({
  status,
  tasks,
  stepCount,
});

describe("decideNextStep", () => {
  it("plans queued runs and retries an interrupted plan", () => {
    expect(decideNextStep(run("queued"))).toEqual({ type: "plan" });
    expect(decideNextStep(run("planning"))).toEqual({ type: "plan" });
  });

  it("works tasks in position order, not insertion order", () => {
    const step = decideNextStep(run("running", [task(2, "pending"), task(1, "pending")]));
    expect(step).toEqual({ type: "develop", taskId: "t1" });
  });

  it("develops pending, fixing and interrupted tasks; tests delivered ones", () => {
    expect(decideNextStep(run("running", [task(1, "fixing", 1)]))).toEqual({ type: "develop", taskId: "t1" });
    expect(decideNextStep(run("running", [task(1, "developing")]))).toEqual({ type: "develop", taskId: "t1" });
    expect(decideNextStep(run("running", [task(1, "testing", 1)]))).toEqual({ type: "test", taskId: "t1" });
  });

  it("skips closed tasks and integrates when none remain", () => {
    expect(decideNextStep(run("running", [task(1, "passed"), task(2, "pending")]))).toEqual({
      type: "develop",
      taskId: "t2",
    });
    expect(decideNextStep(run("running", [task(1, "passed"), task(2, "failed")]))).toEqual({ type: "integrate" });
    expect(decideNextStep(run("integrating", [task(1, "passed")]))).toEqual({ type: "integrate" });
  });

  it("does nothing on terminal runs", () => {
    for (const s of ["done", "done_with_failures", "failed"] as const) {
      expect(decideNextStep(run(s, [task(1, "pending")]))).toEqual({ type: "none" });
    }
  });

  it("aborts runaway or empty runs", () => {
    expect(decideNextStep(run("running", [task(1, "pending")], MAX_STEPS)).type).toBe("abort");
    expect(decideNextStep(run("running", [])).type).toBe("abort");
  });
});

describe("Develop ↔ Testing loop", () => {
  it("counts an attempt on delivery and loops until the attempt limit", () => {
    let t = task(1, "pending");
    const statuses: TaskStatus[] = [];
    for (let i = 0; i < 5 && t.status !== "failed"; i++) {
      t = { ...t, ...afterDelivery(t) };
      t = { ...t, ...afterTest(t, false) };
      statuses.push(t.status);
    }
    expect(statuses).toEqual(["fixing", "fixing", "failed"]);
    expect(t.attempts).toBe(3);
  });

  it("passes as soon as Testing approves", () => {
    const t = { ...task(1, "fixing", 1), ...afterDelivery(task(1, "fixing", 1)) };
    expect(afterTest(t, true)).toEqual({ status: "passed" });
  });

  it("final status reflects task outcomes and integration", () => {
    expect(finalRunStatus([task(1, "passed")], true)).toBe("done");
    expect(finalRunStatus([task(1, "passed"), task(2, "failed")], true)).toBe("done_with_failures");
    expect(finalRunStatus([task(1, "passed")], false)).toBe("done_with_failures");
  });
});

describe("testVerdict", () => {
  const ok: CheckReport = { passed: true, results: [{ id: "a", label: "A", passed: true, details: [] }] };
  const ko: CheckReport = {
    passed: false,
    results: [{ id: "f", label: "Formulario", passed: false, details: ["falta action"] }],
  };
  const review = (verdict: "pass" | "fail", issues: ReviewOutput["issues"] = []): ReviewOutput => ({
    verdict,
    summary: "Resumen de la revisión",
    issues,
  });

  it("requires deterministic checks and no blockers", () => {
    expect(testVerdict(ok, review("pass")).passed).toBe(true);
    expect(testVerdict(ko, review("pass")).failures).toEqual(["Formulario: falta action"]);
    const v = testVerdict(ok, review("fail", [{ severity: "blocker", file: "contacto.html", detail: "Sin teléfono" }]));
    expect(v).toMatchObject({ passed: false, failures: ["Revisión: contacto.html: Sin teléfono"] });
  });

  it("minor issues are remarks, not failures", () => {
    const v = testVerdict(ok, review("pass", [{ severity: "minor", file: null, detail: "Mejorar contraste" }]));
    expect(v).toEqual({ passed: true, failures: [], remarks: ["Mejorar contraste"] });
  });

  it("a fail verdict without blockers still fails with the summary", () => {
    expect(testVerdict(ok, review("fail")).failures).toEqual(["Revisión: Resumen de la revisión"]);
  });

  it("falls back to deterministic checks when the review is unavailable", () => {
    expect(testVerdict(ok, null).passed).toBe(true);
    expect(testVerdict(ko, null).passed).toBe(false);
  });
});
