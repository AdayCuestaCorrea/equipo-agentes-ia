import { z } from "zod";

/** Same rule as the `file_versions.path` check constraint in the SQL migration. */
export const FILE_PATH_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.(html|css|svg)$/;

export const FilePath = z.string().regex(FILE_PATH_RE, "Ruta no válida (minúsculas, sin '..', extensión html/css/svg)");

/** Acceptance criteria the Orchestrator attaches to each task and Testing checks deterministically. */
export const Criterion = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file_exists"), path: FilePath }),
  z.object({
    kind: z.literal("selector"),
    path: FilePath,
    selector: z.string().min(1),
    min: z.number().int().min(1).default(1),
  }),
  z.object({ kind: z.literal("text_contains"), path: FilePath, text: z.string().min(1) }),
  z.object({ kind: z.literal("form_valid"), path: FilePath }),
  z.object({ kind: z.literal("link_exists"), from: FilePath, to: FilePath }),
  z.object({ kind: z.literal("links_valid") }),
]);
export type Criterion = z.infer<typeof Criterion>;

export const PlannedTask = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(2000),
  files: z.array(FilePath).min(1).max(6),
  acceptance: z.array(Criterion).min(1).max(10),
});
export type PlannedTask = z.infer<typeof PlannedTask>;

export const Plan = z.object({
  summary: z.string().min(3).max(600),
  tasks: z.array(PlannedTask).min(1).max(5),
});
export type Plan = z.infer<typeof Plan>;

export const DevelopOutput = z.object({
  summary: z.string().min(3).max(600),
  files: z
    .array(z.object({ path: FilePath, content: z.string().min(1).max(60_000) }))
    .min(1)
    .max(6)
    .refine((fs) => new Set(fs.map((f) => f.path)).size === fs.length, "Ficheros duplicados en la entrega"),
});
export type DevelopOutput = z.infer<typeof DevelopOutput>;

export const ReviewIssue = z.object({
  severity: z.enum(["blocker", "minor"]),
  file: FilePath.nullable(),
  detail: z.string().min(3).max(500),
});
export type ReviewIssue = z.infer<typeof ReviewIssue>;

export const ReviewOutput = z.object({
  verdict: z.enum(["pass", "fail"]),
  summary: z.string().min(3).max(600),
  issues: z.array(ReviewIssue).max(10),
});
export type ReviewOutput = z.infer<typeof ReviewOutput>;
