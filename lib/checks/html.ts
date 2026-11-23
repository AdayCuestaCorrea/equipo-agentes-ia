import path from "node:path";
import * as cheerio from "cheerio";
import { parse } from "parse5";
import type { SiteFiles } from "@/lib/domain/types";

export type Doc = cheerio.CheerioAPI;

export const loadDoc = (html: string): Doc => cheerio.load(html);

export interface ParseProblem {
  code: string;
  line: number;
  col: number;
}

/**
 * parse5 reports tokenizer-level errors (missing doctype, duplicate attributes, EOF in tag…)
 * but silently repairs tree errors, so nesting is checked separately by `nestingProblems`.
 */
export function parseProblems(html: string): ParseProblem[] {
  const problems: ParseProblem[] = [];
  parse(html, {
    onParseError: (e) => problems.push({ code: e.code, line: e.startLine, col: e.startCol }),
  });
  return [...problems, ...nestingProblems(html)].sort((a, b) => a.line - b.line || a.col - b.col);
}

const VOID = new Set(
  "area base br col embed hr img input link meta source track wbr".split(" "),
);
/** Elements whose end tag the HTML spec allows to omit. */
const OPTIONAL_END = new Set(
  "html head body p li dt dd option optgroup tr td th thead tbody tfoot colgroup rt rp caption".split(" "),
);

function position(html: string, index: number) {
  const before = html.slice(0, index);
  const line = before.split("\n").length;
  return { line, col: index - before.lastIndexOf("\n") };
}

/** Detects unclosed, stray and misnested tags, which browsers repair silently. */
export function nestingProblems(html: string): ParseProblem[] {
  // Blank out comments and raw-text content (keeping offsets) so their contents are not read as tags.
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  const src = html
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<(script|style|textarea|title)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (_, open, _t, body, close) => open + blank(body) + close);

  const problems: ParseProblem[] = [];
  const stack: { name: string; index: number }[] = [];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/g;

  for (let m; (m = tag.exec(src)); ) {
    const [, closing, rawName, selfClosing] = m;
    const name = rawName.toLowerCase();
    if (VOID.has(name)) continue;
    if (!closing) {
      if (!selfClosing) stack.push({ name, index: m.index });
      continue;
    }
    const at = stack.map((e) => e.name).lastIndexOf(name);
    const unclosedAbove = at < 0 ? [] : stack.slice(at + 1).filter((e) => !OPTIONAL_END.has(e.name));
    if (at < 0) {
      problems.push({ code: `cierre </${name}> sin etiqueta de apertura`, ...position(html, m.index) });
    } else {
      for (const e of unclosedAbove)
        problems.push({ code: `<${e.name}> sin cerrar antes de </${name}>`, ...position(html, e.index) });
      stack.length = at;
    }
  }
  for (const e of stack.filter((e) => !OPTIONAL_END.has(e.name)))
    problems.push({ code: `<${e.name}> sin cerrar`, ...position(html, e.index) });
  return problems;
}

export type ResolvedHref =
  | { kind: "external" }
  | { kind: "anchor"; id: string }
  | { kind: "internal"; path: string }
  | { kind: "invalid"; reason: string };

/** Resolves an href/src found in `fromPath` against the site, the way the preview iframe will. */
export function resolveHref(fromPath: string, rawHref: string): ResolvedHref {
  const href = rawHref.trim();
  if (!href) return { kind: "invalid", reason: "enlace vacío" };
  if (/^javascript:/i.test(href)) return { kind: "invalid", reason: "usa javascript:" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "external" };
  if (href.startsWith("#")) return { kind: "anchor", id: decodeURIComponent(href.slice(1)) };
  if (href.startsWith("/")) return { kind: "invalid", reason: "ruta absoluta; usa rutas relativas" };

  let target = href.split(/[?#]/, 1)[0];
  if (target === "" || target.endsWith("/")) target += "index.html";
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), target));
  if (resolved.startsWith("..")) return { kind: "invalid", reason: "sale de la raíz del sitio" };
  return { kind: "internal", path: resolved };
}

/** Problems with links, stylesheets and images in one HTML file. */
export function linkProblems(fromPath: string, $: Doc, files: SiteFiles): string[] {
  const problems: string[] = [];
  const refs: { attr: string; value: string }[] = [];
  $("a[href]").each((_, el) => void refs.push({ attr: "href", value: $(el).attr("href") ?? "" }));
  $("link[href]").each((_, el) => void refs.push({ attr: "href", value: $(el).attr("href") ?? "" }));
  $("img[src]").each((_, el) => void refs.push({ attr: "src", value: $(el).attr("src") ?? "" }));

  for (const { attr, value } of refs) {
    const r = resolveHref(fromPath, value);
    if (r.kind === "invalid") problems.push(`${attr}="${value}": ${r.reason}`);
    else if (r.kind === "anchor" && r.id && $(`[id="${r.id.replace(/"/g, '\\"')}"]`).length === 0)
      problems.push(`${attr}="${value}": no existe ningún elemento con id «${r.id}»`);
    else if (r.kind === "internal" && !(r.path in files))
      problems.push(`${attr}="${value}": el fichero ${r.path} no existe`);
  }
  return problems;
}

/** Internal pages (resolved paths) that `fromPath` links to with <a>. */
export function linkedPages(fromPath: string, $: Doc): Set<string> {
  const out = new Set<string>();
  $("a[href]").each((_, el) => {
    const r = resolveHref(fromPath, $(el).attr("href") ?? "");
    if (r.kind === "internal") out.add(r.path);
  });
  return out;
}

const NON_DATA_INPUTS = new Set(["submit", "button", "hidden", "reset", "image"]);

/** Accessibility and validity problems in every <form> of the document. */
export function formProblems($: Doc): string[] {
  const problems: string[] = [];
  $("form").each((i, form) => {
    const f = $(form);
    const label = `formulario ${i + 1}`;
    if (!f.attr("action")?.trim()) problems.push(`${label}: falta el atributo action`);
    const method = (f.attr("method") ?? "").toLowerCase();
    if (method !== "get" && method !== "post") problems.push(`${label}: method debe ser get o post`);

    const controls = f
      .find("input, select, textarea")
      .filter((_, el) => !NON_DATA_INPUTS.has(($(el).attr("type") ?? "text").toLowerCase()));
    if (controls.length === 0) problems.push(`${label}: no tiene campos`);

    controls.each((_, el) => {
      const c = $(el);
      const id = c.attr("id");
      const name = c.attr("name")?.trim();
      const who = `campo ${name || id || el.tagName}`;
      if (!name) problems.push(`${label}: ${who} no tiene name`);
      const hasLabel =
        (id && $(`label[for="${id.replace(/"/g, '\\"')}"]`).length > 0) ||
        c.closest("label").length > 0 ||
        !!c.attr("aria-label")?.trim() ||
        !!c.attr("aria-labelledby")?.trim();
      if (!hasLabel) problems.push(`${label}: ${who} no tiene <label> asociada`);
      const looksEmail = /e-?mail|correo/i.test(`${name ?? ""} ${id ?? ""}`);
      if (looksEmail && el.tagName === "input" && (c.attr("type") ?? "").toLowerCase() !== "email")
        problems.push(`${label}: ${who} debería ser type="email"`);
    });

    const hasSubmit =
      f.find('input[type="submit"]').length > 0 ||
      f.find("button").filter((_, b) => ["", "submit"].includes(($(b).attr("type") ?? "").toLowerCase())).length > 0;
    if (!hasSubmit) problems.push(`${label}: no tiene botón de envío`);
  });
  return problems;
}

/** Cheap structural CSS check: braces balance once comments and strings are removed. */
export function cssProblems(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  let depth = 0;
  for (const ch of stripped) {
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) return ["hay una llave '}' de más"];
  }
  return depth === 0 ? [] : [`faltan ${depth} llave(s) '}' por cerrar`];
}
