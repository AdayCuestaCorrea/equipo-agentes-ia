/**
 * End-to-end smoke test over HTTP against a running app: signs in like the browser does,
 * creates a run, follows its events in the database and checks the preview of the result.
 *
 *   SMOKE_EMAIL=… SMOKE_PASSWORD=… npm run smoke -- [demo|live] [baseUrl]
 */
import { createServerClient } from "@supabase/ssr";
import { serviceClient } from "@/lib/db/supabase-repo";
import { DEMO_PROMPT } from "@/lib/server/engine";

const mode = (process.argv[2] ?? "demo") as "demo" | "live";
const base = process.argv[3] ?? "http://localhost:3000";

async function sessionCookie(): Promise<string> {
  const jar = new Map<string, string>();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await supabase.auth.signInWithPassword({
    email: process.env.SMOKE_EMAIL!,
    password: process.env.SMOKE_PASSWORD!,
  });
  if (error) throw new Error(`Login: ${error.message}`);
  return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function main() {
  const anon = await fetch(`${base}/api/runs`, { method: "POST", body: JSON.stringify({ prompt: DEMO_PROMPT }) });
  console.log(`Sin sesión → ${anon.status} (se espera 401)`);

  const cookie = await sessionCookie();
  const res = await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ prompt: DEMO_PROMPT, mode }),
  });
  const body = (await res.json()) as { id?: string; error?: string };
  console.log(`Con sesión → ${res.status}`, body);
  if (!body.id) process.exit(1);

  const db = serviceClient();
  const started = Date.now();
  let lastId = 0;
  let run: { status: string; current_version: number; error: string | null } | null = null;
  while (Date.now() - started < 8 * 60_000) {
    const { data: events } = await db.from("agent_events").select().eq("run_id", body.id).gt("id", lastId).order("id");
    for (const e of events ?? []) {
      lastId = e.id;
      const t = ((new Date(e.created_at).getTime() - started) / 1000).toFixed(0).padStart(4);
      console.log(`${t}s ${e.agent.padEnd(12)} ${e.type.padEnd(8)} ${String(e.message).slice(0, 140)}${e.model ? `  [${e.provider}/${e.model}]` : ""}`);
    }
    ({ data: run } = await db.from("runs").select("status, current_version, error").eq("id", body.id).single());
    if (run && ["done", "done_with_failures", "failed"].includes(run.status)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log(`\n■ ${run?.status} en ${((Date.now() - started) / 1000).toFixed(0)} s, v${run?.current_version}${run?.error ? ` (${run.error})` : ""}`);

  const preview = await fetch(`${base}/preview/${body.id}/${run?.current_version}/contacto.html`);
  const html = await preview.text();
  console.log(`Vista previa contacto.html → ${preview.status} ${preview.headers.get("content-type")}`);
  console.log(`  CSP: ${preview.headers.get("content-security-policy")}`);
  console.log(`  <form>: ${html.includes("<form")}, enlace desde index: ${(await (await fetch(`${base}/preview/${body.id}/${run?.current_version}/`)).text()).includes("contacto.html")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
