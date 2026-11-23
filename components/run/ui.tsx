import type { ReactNode } from "react";
import type { Agent, RunStatus } from "@/lib/domain/types";
import { RUN_STATUS_LABEL } from "@/lib/runs/labels";

/** Per-agent accent, used consistently across cards, board and conversation. */
export const AGENT_STYLE: Record<Agent, { dot: string; text: string; ring: string; soft: string; initial: string }> = {
  orchestrator: { dot: "bg-violet-500", text: "text-violet-700", ring: "ring-violet-200", soft: "bg-violet-50", initial: "O" },
  develop: { dot: "bg-sky-500", text: "text-sky-700", ring: "ring-sky-200", soft: "bg-sky-50", initial: "D" },
  testing: { dot: "bg-emerald-500", text: "text-emerald-700", ring: "ring-emerald-200", soft: "bg-emerald-50", initial: "T" },
};

export function AgentAvatar({ agent, size = "md" }: { agent: Agent; size?: "sm" | "md" }) {
  const s = AGENT_STYLE[agent];
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${s.dot} ${
        size === "sm" ? "size-5 text-[10px]" : "size-8 text-sm"
      }`}
    >
      {s.initial}
    </span>
  );
}

const STATUS_TONE: Record<RunStatus, string> = {
  queued: "bg-zinc-100 text-zinc-700",
  planning: "bg-violet-100 text-violet-800",
  running: "bg-sky-100 text-sky-800",
  integrating: "bg-violet-100 text-violet-800",
  done: "bg-emerald-100 text-emerald-800",
  done_with_failures: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const active = !["done", "done_with_failures", "failed"].includes(status);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[status]}`}>
      {active && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {RUN_STATUS_LABEL[status]}
    </span>
  );
}

export function Chip({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "amber" | "red" | "emerald" }) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-700",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
    emerald: "bg-emerald-100 text-emerald-800",
  };
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
