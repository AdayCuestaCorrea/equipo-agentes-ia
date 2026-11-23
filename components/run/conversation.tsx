import { AGENT_LABEL, MESSAGE_KIND_LABEL } from "@/lib/runs/labels";
import type { RunSnapshot } from "@/lib/runs/snapshot";
import { AGENT_STYLE, AgentAvatar } from "./ui";

type Message = RunSnapshot["messages"][number];

function Body({ m }: { m: Message }) {
  const b = m.body;
  switch (m.kind) {
    case "assignment":
      return (
        <>
          <p className="font-medium text-zinc-900">{b.title as string}</p>
          <p className="text-zinc-600">{b.description as string}</p>
        </>
      );
    case "delivery":
      return (
        <>
          <p className="text-zinc-800">{b.summary as string}</p>
          <p className="mt-1 text-xs text-zinc-500">
            v{b.version as number} ·{" "}
            {((b.changed as { path: string; isNew: boolean }[]) ?? []).map((c) => `${c.isNew ? "+" : "~"} ${c.path}`).join(", ")}
          </p>
        </>
      );
    case "feedback":
    case "test_report": {
      const failures = (b.failures as string[]) ?? [];
      const remarks = (b.remarks as string[]) ?? [];
      return (
        <>
          <p className={b.passed === false || m.kind === "feedback" ? "font-medium text-amber-800" : "font-medium text-emerald-700"}>
            {m.kind === "feedback"
              ? `Intento ${b.attempt}: ${failures.length} fallo(s), vuelve a Develop`
              : b.passed
                ? `Intento ${b.attempt}: todo pasa`
                : `Fallida tras ${b.attempt} intentos`}
          </p>
          {failures.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-zinc-700">
              {failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {remarks.length > 0 && <p className="mt-1 text-xs text-zinc-500">Observaciones: {remarks.join(" · ")}</p>}
        </>
      );
    }
    case "summary":
      return <p className="font-medium text-zinc-900">{b.summary as string}</p>;
  }
}

/** The messages agents send each other: assignments, deliveries and test reports. */
export function Conversation({ messages }: { messages: Message[] }) {
  if (messages.length === 0) return <p className="text-sm text-zinc-500">Todavía no hay mensajes entre agentes.</p>;
  return (
    <ol className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
      {messages.map((m) => (
        <li key={m.id} className="flex gap-3">
          <AgentAvatar agent={m.from} size="sm" />
          <div className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-sm ${AGENT_STYLE[m.from].soft}`}>
            <p className="mb-0.5 text-[11px] font-medium text-zinc-500">
              <span className={AGENT_STYLE[m.from].text}>{AGENT_LABEL[m.from]}</span>
              {m.to !== m.from && (
                <>
                  {" → "}
                  <span className={AGENT_STYLE[m.to].text}>{AGENT_LABEL[m.to]}</span>
                </>
              )}
              {" · "}
              {MESSAGE_KIND_LABEL[m.kind]}
            </p>
            <Body m={m} />
          </div>
        </li>
      ))}
    </ol>
  );
}
