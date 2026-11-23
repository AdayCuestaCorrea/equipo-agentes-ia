/**
 * Runs a real request end to end against Gemini (in memory, no database) and saves the
 * LLM answers as the demo-mode recording.
 *
 *   npm run record-demo                         # example request → fixtures/demo-run.json
 *   npm run record-demo -- "otra petición" --out fixtures/otra.json
 */
import fs from "node:fs";
import path from "node:path";
import { MemoryRepo } from "@/lib/db/memory-repo";
import { createRun, runStep } from "@/lib/engine/run-step";
import { RecordingProvider } from "@/lib/llm/demo";
import { GeminiProvider } from "@/lib/llm/gemini";

export const EXAMPLE_REQUEST = "añade una página de contacto a esta web";

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : "fixtures/demo-run.json";
  const prompt = args[0] ?? EXAMPLE_REQUEST;

  const repo = new MemoryRepo();
  const llm = new RecordingProvider(new GeminiProvider());
  const deps = { repo, llm };
  const run = await createRun(deps, { prompt, userId: null, mode: "live" });
  console.log(`▶ «${prompt}»`);

  let printed = 0;
  for (let i = 0; i < 60; i++) {
    const outcome = await runStep(deps, run.id);
    for (const e of repo.events.slice(printed)) {
      const llmInfo = e.model ? `  [${e.model}, ${((e.latencyMs ?? 0) / 1000).toFixed(1)} s]` : "";
      console.log(`  ${e.agent.padEnd(12)} ${e.type.padEnd(8)} ${e.message}${llmInfo}`);
    }
    printed = repo.events.length;
    if (outcome.status !== "executed" && outcome.status !== "error") break;
    if (!outcome.more) break;
  }

  const final = (await repo.getRun(run.id))!;
  const tasks = await repo.listTasks(run.id);
  const calls = repo.events.filter((e) => e.type === "llm_call");
  const totalMs = calls.reduce((s, e) => s + (e.latencyMs ?? 0), 0);
  console.log(`\n■ Estado: ${final.status}${final.error ? ` (${final.error})` : ""}`);
  for (const t of tasks) console.log(`  Tarea ${t.position}: ${t.status} en ${t.attempts} intento(s) · ${t.title}`);
  console.log(`  ${calls.length} llamadas al LLM, ${(totalMs / 1000).toFixed(1)} s en total, máx ${(Math.max(0, ...calls.map((c) => c.latencyMs ?? 0)) / 1000).toFixed(1)} s`);

  if (final.status === "done" || final.status === "done_with_failures") {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ prompt, recordedAt: new Date().toISOString(), answers: llm.recording }, null, 2) + "\n");
    console.log(`  Grabación guardada en ${out}`);
  } else {
    console.log("  No se guarda grabación: la ejecución no terminó.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
