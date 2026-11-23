import type { CheckReport } from "@/lib/checks";
import type { Criterion, ReviewOutput } from "@/lib/domain/schemas";
import type { Agent, RunMode, RunStatus, SiteFiles, TaskStatus } from "@/lib/domain/types";

export interface RunRow {
  id: string;
  userId: string | null;
  prompt: string;
  status: RunStatus;
  mode: RunMode;
  currentVersion: number;
  stepCount: number;
  errorCount: number;
  error: string | null;
  isShowcase: boolean;
  createdAt: string;
  finishedAt: string | null;
}

export interface TaskRow {
  id: string;
  runId: string;
  position: number;
  title: string;
  description: string;
  files: string[];
  acceptance: Criterion[];
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
}

export type AgentState = "idle" | "working" | "waiting" | "done";

export interface AgentEventInput {
  runId: string;
  taskId?: string | null;
  agent: Agent;
  type: "state" | "llm_call" | "check" | "info" | "error";
  message: string;
  data?: unknown;
  provider?: string | null;
  model?: string | null;
  latencyMs?: number | null;
}

export interface AgentMessageInput {
  runId: string;
  taskId?: string | null;
  from: Agent;
  to: Agent;
  kind: "assignment" | "delivery" | "test_report" | "feedback" | "summary";
  body: unknown;
}

export interface TestReportRow {
  taskId: string;
  attempt: number;
  deterministic: CheckReport;
  llmReview: ReviewOutput | null;
  passed: boolean;
  failures: string[];
}

export type NewTask = Pick<TaskRow, "position" | "title" | "description" | "files" | "acceptance">;
export type RunPatch = Partial<Pick<RunRow, "status" | "currentVersion" | "stepCount" | "errorCount" | "error" | "finishedAt" | "isShowcase">>;
export type TaskPatch = Partial<Pick<TaskRow, "status" | "attempts">>;

/** Persistence port of the engine: Supabase in production, in-memory in tests. */
export interface Repo {
  createRun(input: { prompt: string; userId: string | null; mode: RunMode }): Promise<RunRow>;
  getRun(id: string): Promise<RunRow | null>;
  /** Atomically takes the run's lease; null if another step holds it or the run is finished. */
  claimRun(id: string): Promise<RunRow | null>;
  releaseRun(id: string): Promise<void>;
  updateRun(id: string, patch: RunPatch): Promise<void>;

  listTasks(runId: string): Promise<TaskRow[]>;
  insertTasks(runId: string, tasks: NewTask[]): Promise<TaskRow[]>;
  updateTask(id: string, patch: TaskPatch): Promise<void>;

  getFiles(runId: string, version: number): Promise<SiteFiles>;
  saveVersion(runId: string, version: number, files: SiteFiles, meta: { taskId: string | null; createdBy: "template" | "develop" }): Promise<void>;

  addEvent(e: AgentEventInput): Promise<void>;
  addMessage(m: AgentMessageInput): Promise<void>;
  addTestReport(r: TestReportRow): Promise<void>;
  lastTestReport(taskId: string): Promise<TestReportRow | null>;
}
