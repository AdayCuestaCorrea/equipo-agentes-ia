"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { agentViews, durationLabel, isTerminal, versionViews, type RunSnapshot } from "@/lib/runs/snapshot";
import { AgentCard } from "./agent-card";
import { Conversation } from "./conversation";
import { PreviewPane } from "./preview-pane";
import { TaskBoard } from "./task-board";
import { RunStatusBadge, Section } from "./ui";
import { useRunSnapshot, type LiveMode } from "./use-run-snapshot";

const LIVE_LABEL: Record<LiveMode, string> = {
  connecting: "Conectando…",
  realtime: "En directo",
  polling: "Actualizando cada 3 s",
};

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function RunView({ initial }: { initial: RunSnapshot }) {
  const { snapshot, live } = useRunSnapshot(initial);
  const { run } = snapshot;
  const finished = isTerminal(run.status);
  const now = useNow(!finished);
  const versions = versionViews(snapshot);
  const passed = snapshot.tasks.filter((t) => t.status === "passed").length;

  return (
    <div className="flex flex-col gap-5">
      {run.mode === "demo" && (
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <strong>Modo demo — respuestas grabadas.</strong> Las respuestas del LLM se reproducen de una ejecución real
          anterior; las comprobaciones de Testing, las versiones y la vista previa se ejecutan de verdad.
        </p>
      )}

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Petición</p>
          <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl">«{run.prompt}»</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
          <RunStatusBadge status={run.status} />
          {snapshot.tasks.length > 0 && (
            <span className="tabular-nums">
              {passed}/{snapshot.tasks.length} tareas
            </span>
          )}
          <span className="tabular-nums">· {durationLabel(run.createdAt, run.finishedAt, now)}</span>
          <span className="flex items-center gap-1.5 text-xs text-zinc-500">
            · <span className={`size-1.5 rounded-full ${live === "realtime" ? "bg-emerald-500" : "bg-amber-500"}`} />
            {finished ? "Terminada" : LIVE_LABEL[live]}
          </span>
        </div>
      </header>

      {run.error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">La ejecución se detuvo</p>
          <p className="mt-0.5 break-words">{run.error}</p>
          {/no está disponible/.test(run.error) && (
            <p className="mt-1">
              Los LLM gratuitos están saturados o sin cuota. Puedes ver la{" "}
              <Link href="/" className="font-medium underline">
                ejecución de ejemplo
              </Link>{" "}
              o lanzarla en modo demo.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {agentViews(snapshot).map((v) => (
          <AgentCard key={v.agent} view={v} />
        ))}
      </div>

      <Section title="Tablero de tareas">
        <TaskBoard snapshot={snapshot} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Section title="Conversación entre agentes">
            <Conversation messages={snapshot.messages} />
          </Section>
        </div>
        <div className="lg:col-span-3">
          <Section title="Vista previa de la web" aside={<span className="text-xs text-zinc-500">{versions.length} versiones</span>}>
            <PreviewPane runId={run.id} versions={versions} />
          </Section>
        </div>
      </div>
    </div>
  );
}
