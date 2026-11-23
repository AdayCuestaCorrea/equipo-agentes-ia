export const AGENTS = ["orchestrator", "develop", "testing"] as const;
export type Agent = (typeof AGENTS)[number];

export const RUN_STATUSES = [
  "queued",
  "planning",
  "running",
  "integrating",
  "done",
  "done_with_failures",
  "failed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["done", "done_with_failures", "failed"];

export const TASK_STATUSES = ["pending", "developing", "testing", "fixing", "passed", "failed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type RunMode = "live" | "demo";

/** Snapshot of the demo website: relative path → file content. */
export type SiteFiles = Record<string, string>;
