import Link from "next/link";
import { Suspense } from "react";
import { AgentAvatar, RunStatusBadge } from "@/components/run/ui";
import type { RunStatus } from "@/lib/domain/types";
import { AGENT_LABEL, AGENT_ROLE } from "@/lib/runs/labels";
import { publicClient } from "@/lib/supabase/public";

type RunRow = { id: string; prompt: string; status: RunStatus; mode: string; created_at: string; is_showcase: boolean };

async function Showcase() {
  const db = publicClient();
  const { data: featured } = await db
    .from("runs")
    .select("id, prompt, status, mode, created_at, is_showcase")
    .eq("is_showcase", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<RunRow>();
  const { data: recent } = await db
    .from("runs")
    .select("id, prompt, status, mode, created_at, is_showcase")
    .order("created_at", { ascending: false })
    .limit(8)
    .returns<RunRow[]>();
  const showcase = featured ?? recent?.find((r) => r.status === "done") ?? null;

  return (
    <>
      {showcase ? (
        <Link
          href={`/runs/${showcase.id}`}
          className="group block rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-300 hover:shadow"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Ejecución de ejemplo, ya completada</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">«{showcase.prompt}»</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-zinc-600">
            <RunStatusBadge status={showcase.status} />
            <span className="text-sky-700 group-hover:underline">Ver qué hizo cada agente →</span>
          </p>
        </Link>
      ) : (
        <p className="rounded-xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-500">Aún no hay ejecuciones.</p>
      )}

      {recent && recent.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-zinc-900">Últimas ejecuciones</h2>
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
            {recent.map((r) => (
              <li key={r.id}>
                <Link href={`/runs/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50">
                  <span className="min-w-0 flex-1 truncate text-zinc-800">«{r.prompt}»</span>
                  {r.mode === "demo" && <span className="text-[11px] font-medium text-amber-700">demo</span>}
                  <RunStatusBadge status={r.status} />
                  <time className="hidden shrink-0 text-xs tabular-nums text-zinc-400 sm:block">
                    {new Date(r.created_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
        Tres agentes de IA que modifican una web de verdad
      </h1>
      <p className="mt-3 max-w-2xl text-zinc-600">
        Pides un cambio para la web de una panadería («añade una página de contacto a esta web»). El Orquestador lo divide en
        tareas, Develop las implementa y Testing las comprueba con pruebas automáticas y una revisión con LLM, devolviéndolas
        hasta que todo pasa. Cada versión se puede abrir en una vista previa real.
      </p>

      <ol className="mt-6 grid gap-3 sm:grid-cols-3">
        {(["orchestrator", "develop", "testing"] as const).map((a, i) => (
          <li key={a} className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3">
            <AgentAvatar agent={a} />
            <div>
              <p className="text-sm font-semibold text-zinc-900">
                {i + 1}. {AGENT_LABEL[a]}
              </p>
              <p className="text-xs text-zinc-600">{AGENT_ROLE[a]}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8">
        <Suspense fallback={<div className="h-28 animate-pulse rounded-xl bg-zinc-200" />}>
          <Showcase />
        </Suspense>
      </div>
    </main>
  );
}
