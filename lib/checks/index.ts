import type { Criterion } from "@/lib/domain/schemas";
import type { SiteFiles } from "@/lib/domain/types";
import { cssProblems, formProblems, linkedPages, linkProblems, loadDoc, parseProblems, type Doc } from "./html";

export interface CheckResult {
  id: string;
  label: string;
  passed: boolean;
  details: string[];
}

export interface CheckReport {
  passed: boolean;
  results: CheckResult[];
}

const result = (id: string, label: string, details: string[]): CheckResult => ({
  id,
  label,
  passed: details.length === 0,
  details,
});

const htmlPaths = (files: SiteFiles) => Object.keys(files).filter((p) => p.endsWith(".html")).sort();

/** Checks every site must pass after any change, independent of the task. */
export function globalChecks(files: SiteFiles, docs = loadDocs(files)): CheckResult[] {
  const out: CheckResult[] = [];
  for (const p of htmlPaths(files)) {
    const $ = docs.get(p)!;
    out.push(
      result(
        `parse:${p}`,
        `${p} es HTML válido`,
        parseProblems(files[p]).map((e) => `línea ${e.line}, col ${e.col}: ${e.code}`),
      ),
    );
    const meta: string[] = [];
    if (!$("title").first().text().trim()) meta.push("falta <title>");
    if (!$("html").attr("lang")?.trim()) meta.push("falta el atributo lang en <html>");
    out.push(result(`meta:${p}`, `${p} tiene título e idioma`, meta));
    out.push(result(`links:${p}`, `Enlaces y recursos de ${p} válidos`, linkProblems(p, $, files)));
    if ($("form").length > 0) out.push(result(`forms:${p}`, `Formularios de ${p} válidos`, formProblems($)));
  }
  for (const p of Object.keys(files).filter((f) => f.endsWith(".css")).sort()) {
    out.push(result(`css:${p}`, `${p} tiene CSS bien formado`, cssProblems(files[p])));
  }
  return out;
}

function criterionLabel(c: Criterion): string {
  switch (c.kind) {
    case "file_exists":
      return `Existe ${c.path}`;
    case "selector":
      return `${c.path} contiene «${c.selector}»${c.min > 1 ? ` (al menos ${c.min})` : ""}`;
    case "text_contains":
      return `${c.path} incluye el texto «${c.text}»`;
    case "form_valid":
      return `${c.path} tiene un formulario válido`;
    case "link_exists":
      return `${c.from} enlaza a ${c.to}`;
    case "links_valid":
      return "Todos los enlaces internos funcionan";
  }
}

function criterionProblems(c: Criterion, files: SiteFiles, docs: Map<string, Doc>): string[] {
  const docFor = (p: string) => docs.get(p);
  const missing = (p: string) => [`el fichero ${p} no existe`];

  switch (c.kind) {
    case "file_exists":
      return c.path in files ? [] : missing(c.path);
    case "selector": {
      const $ = docFor(c.path);
      if (!$) return missing(c.path);
      try {
        const n = $(c.selector).length;
        return n >= c.min ? [] : [`encontrados ${n}, se esperaban al menos ${c.min}`];
      } catch {
        return [`selector CSS no válido: ${c.selector}`];
      }
    }
    case "text_contains": {
      const $ = docFor(c.path);
      if (!$) return missing(c.path);
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      return norm($("body").text()).includes(norm(c.text)) ? [] : [`no aparece «${c.text}»`];
    }
    case "form_valid": {
      const $ = docFor(c.path);
      if (!$) return missing(c.path);
      if ($("form").length === 0) return ["no hay ningún <form>"];
      return formProblems($);
    }
    case "link_exists": {
      const $ = docFor(c.from);
      if (!$) return missing(c.from);
      return linkedPages(c.from, $).has(c.to) ? [] : [`no hay ningún <a> que lleve a ${c.to}`];
    }
    case "links_valid":
      return htmlPaths(files).flatMap((p) => linkProblems(p, docs.get(p)!, files).map((d) => `${p}: ${d}`));
  }
}

function loadDocs(files: SiteFiles): Map<string, Doc> {
  return new Map(htmlPaths(files).map((p) => [p, loadDoc(files[p])]));
}

/** Deterministic part of Testing: global checks plus the task's acceptance criteria. */
export function runChecks(files: SiteFiles, criteria: Criterion[] = []): CheckReport {
  const docs = loadDocs(files);
  const results = [
    ...globalChecks(files, docs),
    ...criteria.map((c, i) => result(`criterion:${i}`, criterionLabel(c), criterionProblems(c, files, docs))),
  ];
  return { passed: results.every((r) => r.passed), results };
}
