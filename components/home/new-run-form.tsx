"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SUGGESTIONS = [
  "añade una página de contacto a esta web",
  "añade una página de horarios y precios con una tabla",
  "añade una sección de opiniones de clientes en la portada",
];

/** Launches a run. Demo mode replays a recorded run of the example request (no LLM quota used). */
export function NewRunForm({ demoPrompt, demoOnly }: { demoPrompt: string; demoOnly: boolean }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(demoPrompt);
  const [pending, setPending] = useState<"live" | "demo" | null>(null);
  const [error, setError] = useState<{ message: string; demoAvailable?: boolean } | null>(null);

  async function launch(mode: "live" | "demo") {
    setPending(mode);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: mode === "demo" ? demoPrompt : prompt, mode }),
      });
      const body = (await res.json()) as { id?: string; error?: string; demoAvailable?: boolean };
      if (!res.ok || !body.id) throw Object.assign(new Error(body.error ?? "No se pudo lanzar la petición"), body);
      router.push(`/runs/${body.id}`);
    } catch (err) {
      const e = err as Error & { demoAvailable?: boolean };
      setError({ message: e.message, demoAvailable: e.demoAvailable });
      setPending(null);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void launch(demoOnly ? "demo" : "live");
      }}
    >
      <label htmlFor="prompt" className="text-sm font-semibold text-zinc-900">
        Nueva petición para la web de la panadería
      </label>
      <textarea
        id="prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={2}
        maxLength={500}
        required
        disabled={demoOnly}
        className="resize-y rounded-md border border-zinc-300 px-3 py-2 text-zinc-900 disabled:bg-zinc-50"
      />
      {!demoOnly && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setPrompt(s)}
              className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-200"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!demoOnly && (
          <button
            type="submit"
            disabled={pending !== null}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
          >
            {pending === "live" ? "Lanzando…" : "Lanzar con IA en vivo"}
          </button>
        )}
        <button
          type="button"
          onClick={() => void launch("demo")}
          disabled={pending !== null}
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
        >
          {pending === "demo" ? "Lanzando…" : "Ver en modo demo (respuestas grabadas)"}
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        {demoOnly
          ? "La app está en modo demo: se reproduce una ejecución real grabada de la petición de ejemplo."
          : "En vivo usa LLM gratuitos (Groq y Gemini): tarda 1–3 minutos y puede caer a modo demo si se agota la cuota. El modo demo reproduce la petición de ejemplo."}
      </p>
    </form>
  );
}
