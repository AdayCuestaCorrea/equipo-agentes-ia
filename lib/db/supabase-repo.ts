import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Criterion } from "@/lib/domain/schemas";
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

/**
 * Server-only client with the service role key (bypasses RLS). Never import from client
 * components: the key is not NEXT_PUBLIC_, so it is undefined in the browser anyway.
 */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Row = Record<string, unknown>;

const toRun = (r: Row): RunRow => ({
  id: r.id as string,
  userId: (r.user_id as string) ?? null,
  prompt: r.prompt as string,
  status: r.status as RunRow["status"],
  mode: r.mode as RunRow["mode"],
  currentVersion: r.current_version as number,
  stepCount: r.step_count as number,
  errorCount: r.error_count as number,
  error: (r.error as string) ?? null,
  isShowcase: r.is_showcase as boolean,
  createdAt: r.created_at as string,
  finishedAt: (r.finished_at as string) ?? null,
});

const toTask = (r: Row): TaskRow => ({
  id: r.id as string,
  runId: r.run_id as string,
  position: r.position as number,
  title: r.title as string,
  description: r.description as string,
  files: r.files as string[],
  acceptance: r.acceptance as Criterion[],
  status: r.status as TaskRow["status"],
  attempts: r.attempts as number,
  maxAttempts: r.max_attempts as number,
});

const RUN_COLUMNS: Record<keyof RunPatch, string> = {
  status: "status",
  currentVersion: "current_version",
  stepCount: "step_count",
  errorCount: "error_count",
  error: "error",
  finishedAt: "finished_at",
  isShowcase: "is_showcase",
};

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`BD (${what}): ${res.error.message}`);
  return res.data;
}

export class SupabaseRepo implements Repo {
  constructor(private readonly db: SupabaseClient = serviceClient()) {}

  async createRun(input: { prompt: string; userId: string | null; mode: RunRow["mode"] }) {
    const data = check(
      await this.db.from("runs").insert({ prompt: input.prompt, user_id: input.userId, mode: input.mode }).select().single(),
      "crear ejecución",
    );
    return toRun(data);
  }

  async getRun(id: string) {
    const data = check(await this.db.from("runs").select().eq("id", id).maybeSingle(), "leer ejecución");
    return data ? toRun(data) : null;
  }

  async claimRun(id: string) {
    const data = check(await this.db.rpc("claim_run", { p_run_id: id }), "reclamar ejecución") as Row[] | null;
    return data && data.length > 0 ? toRun(data[0]) : null;
  }

  async releaseRun(id: string) {
    check(await this.db.rpc("release_run", { p_run_id: id }), "liberar ejecución");
  }

  async updateRun(id: string, patch: RunPatch) {
    const row = Object.fromEntries(Object.entries(patch).map(([k, v]) => [RUN_COLUMNS[k as keyof RunPatch], v]));
    check(await this.db.from("runs").update(row).eq("id", id), "actualizar ejecución");
  }

  async listTasks(runId: string) {
    const data = check(await this.db.from("tasks").select().eq("run_id", runId).order("position"), "leer tareas");
    return (data ?? []).map(toTask);
  }

  async insertTasks(runId: string, tasks: NewTask[]) {
    const data = check(
      await this.db
        .from("tasks")
        .insert(tasks.map((t) => ({ run_id: runId, ...t })))
        .select()
        .order("position"),
      "crear tareas",
    );
    return (data ?? []).map(toTask);
  }

  async updateTask(id: string, patch: TaskPatch) {
    check(await this.db.from("tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id), "actualizar tarea");
  }

  async getFiles(runId: string, version: number): Promise<SiteFiles> {
    const data = check(
      await this.db.from("file_versions").select("path, content").eq("run_id", runId).eq("version", version),
      "leer ficheros",
    );
    if (!data?.length) throw new Error(`La versión ${version} no existe`);
    return Object.fromEntries(data.map((f) => [f.path as string, f.content as string]));
  }

  async saveVersion(runId: string, version: number, files: SiteFiles, meta: { taskId: string | null; createdBy: "template" | "develop" }) {
    const rows = Object.entries(files).map(([path, content]) => ({
      run_id: runId,
      version,
      path,
      content,
      task_id: meta.taskId,
      created_by: meta.createdBy,
    }));
    check(await this.db.from("file_versions").insert(rows), "guardar versión");
  }

  async addEvent(e: AgentEventInput) {
    check(
      await this.db.from("agent_events").insert({
        run_id: e.runId,
        task_id: e.taskId ?? null,
        agent: e.agent,
        type: e.type,
        message: e.message,
        data: e.data ?? null,
        provider: e.provider ?? null,
        model: e.model ?? null,
        latency_ms: e.latencyMs ?? null,
      }),
      "registrar evento",
    );
  }

  async addMessage(m: AgentMessageInput) {
    check(
      await this.db.from("agent_messages").insert({
        run_id: m.runId,
        task_id: m.taskId ?? null,
        from_agent: m.from,
        to_agent: m.to,
        kind: m.kind,
        body: m.body,
      }),
      "registrar mensaje",
    );
  }

  async addTestReport(r: TestReportRow) {
    check(
      await this.db.from("test_reports").insert({
        task_id: r.taskId,
        attempt: r.attempt,
        deterministic: r.deterministic,
        llm_review: r.llmReview,
        passed: r.passed,
        failures: r.failures,
      }),
      "guardar informe",
    );
  }

  async lastTestReport(taskId: string) {
    const data = check(
      await this.db.from("test_reports").select().eq("task_id", taskId).order("attempt", { ascending: false }).limit(1).maybeSingle(),
      "leer informe",
    );
    if (!data) return null;
    return {
      taskId,
      attempt: data.attempt as number,
      deterministic: data.deterministic,
      llmReview: data.llm_review,
      passed: data.passed as boolean,
      failures: data.failures as string[],
    } as TestReportRow;
  }
}
