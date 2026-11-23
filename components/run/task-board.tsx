import { TASK_COLUMNS } from "@/lib/runs/labels";
import type { RunSnapshot } from "@/lib/runs/snapshot";
import { Chip } from "./ui";

type Task = RunSnapshot["tasks"][number];

const COLUMN_TONE: Record<Task["status"], string> = {
  pending: "border-zinc-200",
  developing: "border-sky-300",
  testing: "border-emerald-300",
  fixing: "border-amber-300",
  passed: "border-emerald-500",
  failed: "border-red-400",
};

/** Kanban of the Orchestrator's tasks; the last Testing feedback is shown on tasks being fixed. */
export function TaskBoard({ snapshot }: { snapshot: RunSnapshot }) {
  const lastFeedback = new Map<string, string[]>();
  for (const m of snapshot.messages)
    if (m.kind === "feedback" && m.taskId) lastFeedback.set(m.taskId, (m.body.failures as string[]) ?? []);

  if (snapshot.tasks.length === 0) {
    return <p className="text-sm text-zinc-500">El Orquestador todavía no ha repartido las tareas.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {TASK_COLUMNS.map((col) => {
        const tasks = snapshot.tasks.filter((t) => t.status === col.status);
        return (
          <div key={col.status} className="min-w-0 rounded-lg bg-zinc-50 p-2">
            <h3 className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-zinc-600">
              {col.label}
              <span className="tabular-nums text-zinc-400">{tasks.length}</span>
            </h3>
            <ul className="space-y-2">
              {tasks.map((t) => (
                <li key={t.id} className={`rounded-md border-l-4 bg-white p-2.5 shadow-sm ${COLUMN_TONE[t.status]}`}>
                  <p className="text-[11px] font-medium text-zinc-400">Tarea {t.position}</p>
                  <p className="text-sm font-medium leading-snug text-zinc-900">{t.title}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Chip tone={t.attempts > 1 ? "amber" : "zinc"}>
                      Intento {Math.max(t.attempts, t.status === "pending" ? 0 : 1)}/{t.maxAttempts}
                    </Chip>
                    <Chip>{t.acceptance.length} criterios</Chip>
                  </div>
                  {t.status === "fixing" && lastFeedback.get(t.id)?.length ? (
                    <ul className="mt-2 space-y-0.5 text-[11px] text-amber-800">
                      {lastFeedback.get(t.id)!.slice(0, 3).map((f) => (
                        <li key={f} className="line-clamp-2">
                          ✗ {f}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
