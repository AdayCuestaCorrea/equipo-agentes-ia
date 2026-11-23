import type { SupabaseClient } from "@supabase/supabase-js";
import type { Agent, RunMode, RunStatus, TaskStatus } from "@/lib/domain/types";
import type { Criterion } from "@/lib/domain/schemas";
import { TERMINAL_RUN_STATUSES } from "@/lib/domain/types";
import { TEMPLATE } from "@/lib/domain/template.generated";

/** Everything the run page shows, read with the anon key (public SELECT under RLS). */
export interface RunSnapshot {
  run: {
    id: string;
    prompt: string;
    status: RunStatus;
    mode: RunMode;
    currentVersion: number;
    error: string | null;
    isShowcase: boolean;
    createdAt: string;
    finishedAt: string | null;
  };
  tasks: {
    id: string;
    position: number;
    title: string;
    description: string;
    files: string[];
    acceptance: Criterion[];
    status: TaskStatus;
    attempts: number;
    maxAttempts: number;
  }[];
  events: {
    id: number;
    taskId: string | null;
    agent: Agent;
    type: "state" | "llm_call" | "check" | "info" | "error";
    message: string;
    data: Record<string, unknown> | null;
    provider: string | null;
    model: string | null;
    latencyMs: number | null;
    createdAt: string;
  }[];
  messages: {
    id: number;
    taskId: string | null;
    from: Agent;
    to: Agent;
    kind: "assignment" | "delivery" | "test_report" | "feedback" | "summary";
    body: Record<string, unknown>;
    createdAt: string;
  }[];
}

export async function loadSnapshot(db: SupabaseClient, runId: string): Promise<RunSnapshot | null> {
  const [run, tasks, events, messages] = await Promise.all([
    db.from("runs").select().eq("id", runId).maybeSingle(),
    db.from("tasks").select().eq("run_id", runId).order("position"),
    db.from("agent_events").select().eq("run_id", runId).order("id"),
    db.from("agent_messages").select().eq("run_id", runId).order("id"),
  ]);
  const err = run.error ?? tasks.error ?? events.error ?? messages.error;
  if (err) throw new Error(`No se pudo leer la ejecución: ${err.message}`);
  if (!run.data) return null;
  const r = run.data;
  return {
    run: {
      id: r.id,
      prompt: r.prompt,
      status: r.status,
      mode: r.mode,
      currentVersion: r.current_version,
      error: r.error,
      isShowcase: r.is_showcase,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
    },
    tasks: (tasks.data ?? []).map((t) => ({
      id: t.id,
      position: t.position,
      title: t.title,
      description: t.description,
      files: t.files,
      acceptance: t.acceptance,
      status: t.status,
      attempts: t.attempts,
      maxAttempts: t.max_attempts,
    })),
    events: (events.data ?? []).map((e) => ({
      id: e.id,
      taskId: e.task_id,
      agent: e.agent,
      type: e.type,
      message: e.message,
      data: e.data,
      provider: e.provider,
      model: e.model,
      latencyMs: e.latency_ms,
      createdAt: e.created_at,
    })),
    messages: (messages.data ?? []).map((m) => ({
      id: m.id,
      taskId: m.task_id,
      from: m.from_agent,
      to: m.to_agent,
      kind: m.kind,
      body: m.body,
      createdAt: m.created_at,
    })),
  };
}

// ── Pure derivations for the UI ───────────────────────────────────────────────

export type AgentUiState = "idle" | "working" | "waiting" | "done" | "error";

export interface AgentView {
  agent: Agent;
  state: AgentUiState;
  /** What the agent is doing or last did. */
  current: string | null;
  events: RunSnapshot["events"];
  llmCalls: number;
  providers: string[];
}

export const isTerminal = (s: RunStatus) => TERMINAL_RUN_STATUSES.includes(s);

export function agentViews(s: RunSnapshot): AgentView[] {
  return (["orchestrator", "develop", "testing"] as const).map((agent) => {
    const events = s.events.filter((e) => e.agent === agent);
    const lastState = [...events].reverse().find((e) => e.type === "state");
    let state = ((lastState?.data?.state as AgentUiState | undefined) ?? "idle") as AgentUiState;
    if (s.run.status === "failed") state = "error";
    else if (isTerminal(s.run.status)) state = "done";
    const calls = events.filter((e) => e.type === "llm_call");
    return {
      agent,
      state,
      current: lastState?.message ?? null,
      events,
      llmCalls: calls.length,
      providers: [...new Set(calls.map((c) => modelLabel(c.provider, c.model, c.data?.fallback === true)))],
    };
  });
}

/** Human label for who answered a call, e.g. "Groq · gpt-oss-120b" or "Demo (grabado)". */
export function modelLabel(provider: string | null, model: string | null, fallback = false): string {
  if (provider === "demo") return "Demo (respuestas grabadas)";
  const name = provider === "groq" ? "Groq" : provider === "gemini" ? "Gemini" : (provider ?? "LLM");
  const short = (model ?? "").replace(/^openai\//, "").replace(/^gemini-/, "");
  return `${name} · ${short}${fallback ? " (respaldo)" : ""}`;
}

export interface VersionView {
  version: number;
  label: string;
  taskPosition: number | null;
  changed: { path: string; isNew: boolean }[];
}

/** Version 0 (template) plus one version per Develop delivery, from the delivery messages. */
export function versionViews(s: RunSnapshot): VersionView[] {
  const byTask = new Map(s.tasks.map((t) => [t.id, t.position]));
  const deliveries = s.messages
    .filter((m) => m.kind === "delivery")
    .map((m) => {
      const pos = m.taskId ? (byTask.get(m.taskId) ?? null) : null;
      return {
        version: m.body.version as number,
        label: `v${m.body.version} · tarea ${pos ?? "?"}, intento ${m.body.attempt}`,
        taskPosition: pos,
        changed: (m.body.changed as VersionView["changed"]) ?? [],
      };
    });
  return [{ version: 0, label: "v0 · web original", taskPosition: null, changed: [] }, ...deliveries];
}

/** Pages a version contains (template pages plus every page created up to it). */
export function pagesAt(versions: VersionView[], version: number): string[] {
  const pages = new Set(Object.keys(TEMPLATE).filter((p) => p.endsWith(".html")));
  for (const v of versions) if (v.version <= version) for (const c of v.changed) if (c.path.endsWith(".html")) pages.add(c.path);
  return [...pages].sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)));
}

export function durationLabel(fromIso: string, toIso: string | null, now = Date.now()): string {
  const ms = (toIso ? new Date(toIso).getTime() : now) - new Date(fromIso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
