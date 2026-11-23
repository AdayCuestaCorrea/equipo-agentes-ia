import type { SiteFiles } from "@/lib/domain/types";
import type {
  AgentEventInput,
  AgentMessageInput,
  NewTask,
  Repo,
  RunPatch,
  RunRow,
  TaskPatch,
  TaskRow,
  TestReportRow,
} from "@/lib/engine/repo";

/** In-memory Repo for tests and local scripts. Mirrors the Supabase semantics, including the lease. */
export class MemoryRepo implements Repo {
  runs = new Map<string, RunRow & { lockedUntil: number }>();
  tasks: TaskRow[] = [];
  versions = new Map<string, SiteFiles>();
  events: (AgentEventInput & { id: number })[] = [];
  messages: (AgentMessageInput & { id: number })[] = [];
  reports: TestReportRow[] = [];
  private seq = 0;

  constructor(private readonly leaseMs = 150_000) {}

  private id = (prefix: string) => `${prefix}-${++this.seq}`;

  async createRun(input: { prompt: string; userId: string | null; mode: RunRow["mode"] }) {
    const run: RunRow & { lockedUntil: number } = {
      id: this.id("run"),
      userId: input.userId,
      prompt: input.prompt,
      status: "queued",
      mode: input.mode,
      currentVersion: 0,
      stepCount: 0,
      errorCount: 0,
      error: null,
      isShowcase: false,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      lockedUntil: 0,
    };
    this.runs.set(run.id, run);
    return strip(run);
  }

  async getRun(id: string) {
    const r = this.runs.get(id);
    return r ? strip(r) : null;
  }

  async claimRun(id: string) {
    const r = this.runs.get(id);
    if (!r || r.lockedUntil > Date.now() || ["done", "done_with_failures", "failed"].includes(r.status)) return null;
    r.lockedUntil = Date.now() + this.leaseMs;
    return strip(r);
  }

  async releaseRun(id: string) {
    const r = this.runs.get(id);
    if (r) r.lockedUntil = 0;
  }

  async updateRun(id: string, patch: RunPatch) {
    const r = this.runs.get(id);
    if (!r) throw new Error(`run ${id} no existe`);
    Object.assign(r, patch);
  }

  async listTasks(runId: string) {
    return this.tasks.filter((t) => t.runId === runId).map((t) => ({ ...t }));
  }

  async insertTasks(runId: string, tasks: NewTask[]) {
    const rows = tasks.map((t) => ({
      ...t,
      id: this.id("task"),
      runId,
      status: "pending" as const,
      attempts: 0,
      maxAttempts: 3,
    }));
    this.tasks.push(...rows);
    return rows.map((t) => ({ ...t }));
  }

  async updateTask(id: string, patch: TaskPatch) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`task ${id} no existe`);
    Object.assign(t, patch);
  }

  async getFiles(runId: string, version: number) {
    const files = this.versions.get(`${runId}@${version}`);
    if (!files) throw new Error(`versión ${version} de ${runId} no existe`);
    return { ...files };
  }

  async saveVersion(runId: string, version: number, files: SiteFiles) {
    const key = `${runId}@${version}`;
    if (this.versions.has(key)) throw new Error(`la versión ${version} ya existe`);
    this.versions.set(key, { ...files });
  }

  async addEvent(e: AgentEventInput) {
    this.events.push({ ...e, id: ++this.seq });
  }

  async addMessage(m: AgentMessageInput) {
    this.messages.push({ ...m, id: ++this.seq });
  }

  async addTestReport(r: TestReportRow) {
    this.reports.push(r);
  }

  async lastTestReport(taskId: string) {
    const rs = this.reports.filter((r) => r.taskId === taskId).sort((a, b) => b.attempt - a.attempt);
    return rs[0] ?? null;
  }
}

function strip({ lockedUntil: _l, ...run }: RunRow & { lockedUntil: number }): RunRow {
  return { ...run };
}
