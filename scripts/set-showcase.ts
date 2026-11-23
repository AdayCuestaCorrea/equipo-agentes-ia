/**
 * Marks one finished run as the home page's featured run (and unmarks the rest).
 *   npm run set-showcase -- <runId>
 */
import { serviceClient } from "@/lib/db/supabase-repo";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Uso: npm run set-showcase -- <runId>");
  const db = serviceClient();
  const { data: run } = await db.from("runs").select("status").eq("id", id).maybeSingle();
  if (run?.status !== "done") throw new Error(`La ejecución ${id} no existe o no está completada (${run?.status})`);
  await db.from("runs").update({ is_showcase: false }).eq("is_showcase", true);
  const { error } = await db.from("runs").update({ is_showcase: true }).eq("id", id);
  if (error) throw error;
  console.log(`Ejecución destacada: ${id}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
