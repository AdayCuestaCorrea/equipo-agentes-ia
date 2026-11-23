import { AGENT_LABEL, AGENT_ROLE, AGENT_STATE_LABEL } from "@/lib/runs/labels";
import type { AgentUiState, AgentView } from "@/lib/runs/snapshot";
import { AGENT_STYLE, AgentAvatar, Chip } from "./ui";

const STATE_TONE: Record<AgentUiState, string> = {
  idle: "bg-zinc-100 text-zinc-600",
  working: "bg-sky-100 text-sky-800",
  waiting: "bg-amber-50 text-amber-800",
  done: "bg-emerald-100 text-emerald-800",
  error: "bg-red-100 text-red-700",
};

const EVENT_ICON: Record<string, string> = { state: "•", llm_call: "✦", check: "✓", info: "i", error: "!" };

const time = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function AgentCard({ view }: { view: AgentView }) {
  const s = AGENT_STYLE[view.agent];
  const log = view.events.filter((e) => e.type !== "state").slice(-6).reverse();
  return (
    <article className={`flex flex-col rounded-xl border border-zinc-200 bg-white ring-1 ring-inset ${view.state === "working" ? s.ring : "ring-transparent"}`}>
      <header className="flex items-start gap-3 p-4 pb-3">
        <AgentAvatar agent={view.agent} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className={`font-semibold ${s.text}`}>{AGENT_LABEL[view.agent]}</h3>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[view.state]}`}>
              {view.state === "working" && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
              {AGENT_STATE_LABEL[view.state]}
            </span>
          </div>
          <p className="text-xs text-zinc-500">{AGENT_ROLE[view.agent]}</p>
        </div>
      </header>

      <p className="mx-4 min-h-10 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-800">{view.current ?? "Aún no ha empezado"}</p>

      <ol className="mt-3 flex-1 space-y-1.5 px-4 text-xs" aria-label={`Registro de ${AGENT_LABEL[view.agent]}`}>
        {log.length === 0 && <li className="text-zinc-400">Sin actividad todavía</li>}
        {log.map((e) => (
          <li key={e.id} className="flex gap-2">
            <span className={`w-3 shrink-0 text-center ${e.type === "error" ? "text-red-600" : "text-zinc-400"}`}>{EVENT_ICON[e.type]}</span>
            <span className={`line-clamp-2 flex-1 ${e.type === "error" ? "text-red-700" : "text-zinc-600"}`}>{e.message}</span>
            <time className="shrink-0 tabular-nums text-zinc-400">{time(e.createdAt)}</time>
          </li>
        ))}
      </ol>

      <footer className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-zinc-100 px-4 py-2.5">
        <span className="text-[11px] text-zinc-500">{view.llmCalls} llamada(s) al LLM</span>
        {view.providers.map((p) => (
          <Chip key={p} tone={p.includes("respaldo") ? "amber" : "zinc"}>
            {p}
          </Chip>
        ))}
      </footer>
    </article>
  );
}
