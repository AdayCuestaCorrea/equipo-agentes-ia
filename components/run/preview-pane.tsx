"use client";

import { useState } from "react";
import { pagesAt, type VersionView } from "@/lib/runs/snapshot";

/** Renders a real version of the website (served from the DB) in a sandboxed iframe. */
export function PreviewPane({ runId, versions }: { runId: string; versions: VersionView[] }) {
  const latest = versions.at(-1)!.version;
  // null = follow the latest delivery; a number = the version the user picked.
  const [picked, setPicked] = useState<number | null>(null);
  const [page, setPage] = useState("index.html");
  const version = picked ?? latest;

  const current = versions.find((v) => v.version === version) ?? versions.at(-1)!;
  const pages = pagesAt(versions, version);
  const shown = pages.includes(page) ? page : "index.html";
  const src = `/preview/${runId}/${version}/${shown}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-zinc-500" htmlFor="version">
          Versión
        </label>
        <select
          id="version"
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm"
          value={version}
          onChange={(e) => {
            const v = Number(e.target.value);
            setPicked(v === latest ? null : v);
          }}
        >
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              {v.label}
            </option>
          ))}
        </select>
        <nav className="flex flex-wrap gap-1" aria-label="Páginas de la web">
          {pages.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              className={`rounded-md px-2 py-1 text-xs ${p === shown ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}
            >
              {p}
            </button>
          ))}
        </nav>
        <a href={src} target="_blank" rel="noreferrer" className="ml-auto text-xs text-sky-700 hover:underline">
          Abrir en pestaña nueva ↗
        </a>
      </div>

      {current.changed.length > 0 && (
        <p className="text-xs text-zinc-500">
          Cambios en esta versión:{" "}
          {current.changed.map((c) => (
            <span key={c.path} className={`mr-1.5 font-mono ${c.isNew ? "text-emerald-700" : "text-amber-700"}`}>
              {c.isNew ? "+" : "~"}
              {c.path}
            </span>
          ))}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-300 bg-white">
        <div className="flex items-center gap-1.5 border-b border-zinc-200 bg-zinc-100 px-3 py-1.5">
          <span className="size-2.5 rounded-full bg-zinc-300" />
          <span className="size-2.5 rounded-full bg-zinc-300" />
          <span className="size-2.5 rounded-full bg-zinc-300" />
          <span className="ml-2 truncate font-mono text-[11px] text-zinc-500">la-espiga / v{version} / {shown}</span>
        </div>
        {/* No allow-scripts / allow-forms: the generated site is shown, never executed. */}
        <iframe key={src} title={`Vista previa de ${shown}, versión ${version}`} src={src} sandbox="allow-same-origin" className="h-[34rem] w-full" />
      </div>
    </div>
  );
}
