import { serviceClient } from "@/lib/db/supabase-repo";
import { FILE_PATH_RE } from "@/lib/domain/schemas";

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
};

/**
 * Generated pages run with no scripts, no outside requests and no form submission:
 * they are previewed, not executed. Framing is limited to this app.
 */
const CSP = [
  "default-src 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

/** Serves one file of one version of a run's website, so the iframe renders the real result. */
export async function GET(_req: Request, ctx: RouteContext<"/preview/[runId]/[version]/[[...path]]">) {
  const { runId, version, path: segments } = await ctx.params;
  const path = segments?.length ? segments.join("/") : "index.html";
  const v = Number(version);
  if (!FILE_PATH_RE.test(path) || !Number.isInteger(v) || v < 0 || !/^[0-9a-f-]{36}$/.test(runId)) {
    return new Response("Ruta no válida", { status: 400 });
  }

  const { data, error } = await serviceClient()
    .from("file_versions")
    .select("content")
    .eq("run_id", runId)
    .eq("version", v)
    .eq("path", path)
    .maybeSingle();
  if (error) return new Response("Error al leer el fichero", { status: 500 });
  if (!data) return new Response(`No existe ${path} en la versión ${v}`, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  return new Response(data.content as string, {
    headers: {
      "Content-Type": CONTENT_TYPES[path.split(".").pop()!],
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      // A version never changes once written.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
