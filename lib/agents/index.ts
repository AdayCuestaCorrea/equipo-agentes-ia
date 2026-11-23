import { z } from "zod";
import type { CheckReport } from "@/lib/checks";
import {
  Criterion,
  DevelopOutput,
  Plan,
  ReviewOutput,
  type PlannedTask,
} from "@/lib/domain/schemas";
import type { SiteFiles } from "@/lib/domain/types";
import { LLMOutputError, type GenerateResult, type LLMProvider } from "@/lib/llm/types";

export type CallMeta = Omit<GenerateResult<unknown>, "data">;
const meta = ({ data: _d, ...m }: GenerateResult<unknown>): CallMeta => m;

const CRITERIA_KINDS = ["file_exists", "selector", "text_contains", "form_valid", "link_exists", "links_valid"] as const;

/**
 * LLM-facing plan schema: criteria are flat objects (unused fields null) instead of a
 * discriminated union, because structured-output APIs support `anyOf` poorly. They are
 * normalised into the strict domain `Plan` afterwards.
 */
export const PlanLLM = z.object({
  summary: z.string(),
  tasks: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        files: z.array(z.string()).min(1).max(6),
        acceptance: z
          .array(
            z.object({
              kind: z.enum(CRITERIA_KINDS),
              path: z.string().nullable(),
              selector: z.string().nullable(),
              text: z.string().nullable(),
              from: z.string().nullable(),
              to: z.string().nullable(),
              min: z.number().int().nullable(),
            }),
          )
          .min(1)
          .max(10),
      }),
    )
    .min(1)
    .max(5),
});
export type PlanLLM = z.infer<typeof PlanLLM>;

/** Converts the flat LLM plan into the strict domain plan; unusable criteria are dropped with a warning. */
export function normalizePlan(raw: PlanLLM): { plan: Plan; warnings: string[] } {
  const warnings: string[] = [];
  const tasks: PlannedTask[] = raw.tasks.map((t, ti) => {
    const acceptance = t.acceptance.flatMap((c) => {
      const { kind, path, selector, text, from, to, min } = c;
      const candidate = { kind, path, selector, text, from, to, ...(min !== null ? { min } : {}) };
      const parsed = Criterion.safeParse(Object.fromEntries(Object.entries(candidate).filter(([, v]) => v !== null)));
      if (parsed.success) return [parsed.data];
      warnings.push(`Tarea ${ti + 1}: criterio «${kind}» descartado (${parsed.error.issues[0]?.message})`);
      return [];
    });
    if (acceptance.length === 0) acceptance.push({ kind: "file_exists", path: t.files[0] });
    return { title: t.title, description: t.description, files: t.files, acceptance };
  });
  const plan = Plan.safeParse({ summary: raw.summary, tasks });
  if (!plan.success) throw new LLMOutputError(`Plan no válido: ${z.prettifyError(plan.error)}`);
  return { plan: plan.data, warnings };
}

const renderSite = (files: SiteFiles) =>
  Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, c]) => `=== ${p} ===\n${c}`)
    .join("\n\n");

const renderCriteria = (cs: Criterion[]) => cs.map((c) => `- ${JSON.stringify(c)}`).join("\n");

// ── Orquestador ───────────────────────────────────────────────────────────────

export const ORCHESTRATOR_SYSTEM = `Eres el Orquestador de un equipo de tres agentes de IA (Orquestador, Develop, Testing) que modifica una web estática hecha solo con HTML y CSS (sin JavaScript ni paso de build).
Recibes la petición del usuario y el contenido actual de la web. Divide la petición en entre 1 y 4 tareas pequeñas y ordenadas que Develop pueda implementar una a una y Testing verificar automáticamente.

Reglas:
- Cada tarea: título corto; descripción concreta (qué ficheros crear o modificar y qué deben contener); lista de ficheros; criterios de aceptación verificables.
- Rutas relativas, en minúsculas, con extensión .html, .css o .svg (por ejemplo contacto.html).
- Tipos de criterio (rellena solo los campos de su tipo; el resto, null):
  · file_exists {path}: el fichero existe.
  · selector {path, selector, min}: el selector CSS aparece al menos min veces.
  · text_contains {path, text}: la página contiene ese texto visible.
  · form_valid {path}: hay un formulario con action, method, name y <label> en cada campo, email con type="email" y botón de envío.
  · link_exists {from, to}: hay un enlace <a> de la página from a la página to.
  · links_valid {}: todos los enlaces internos de la web funcionan.
- Si se crea una página nueva, asegúrate de que queda enlazada desde la navegación de las páginas existentes (con criterios link_exists).
- No pidas JavaScript, librerías externas ni imágenes binarias.
- Escribe en español.`;

export async function orchestratorPlan(llm: LLMProvider, input: { request: string; files: SiteFiles }) {
  const res = await llm.generate({
    key: "plan",
    schema: PlanLLM,
    system: ORCHESTRATOR_SYSTEM,
    prompt: `Petición del usuario: «${input.request}»\n\nContenido actual de la web:\n\n${renderSite(input.files)}`,
  });
  return { ...normalizePlan(res.data), meta: meta(res) };
}

// ── Develop ───────────────────────────────────────────────────────────────────

export const DEVELOP_SYSTEM = `Eres Develop, el agente desarrollador de un equipo de tres agentes de IA. Implementas UNA tarea sobre una web estática HTML + CSS.

Reglas:
- Devuelve el contenido COMPLETO de cada fichero que crees o modifiques (nada de diffs ni fragmentos). No incluyas ficheros que no cambien.
- HTML5 válido: <!DOCTYPE html>, <html lang="es">, <meta charset>, <title>, todas las etiquetas cerradas y bien anidadas.
- Enlaces y recursos con rutas relativas (contacto.html, styles.css), nunca absolutas (/contacto.html).
- Sin JavaScript. Reutiliza styles.css y la estructura existente (cabecera, navegación, pie) para que todas las páginas sean coherentes; si hacen falta estilos nuevos, modifica styles.css.
- Formularios accesibles: action y method, cada campo con name y <label for> asociada, email con type="email" y un botón de envío.
- Si recibes fallos de Testing, corrígelos todos sin romper lo que ya funcionaba.
- summary: qué has hecho, en 1 o 2 frases en español.`;

export interface DevelopInput {
  request: string;
  task: PlannedTask & { position: number };
  attempt: number;
  files: SiteFiles;
  feedback: string[];
}

export async function developTask(llm: LLMProvider, input: DevelopInput) {
  const { task } = input;
  const feedback = input.feedback.length
    ? `\n\nTu entrega anterior NO pasó las pruebas. Fallos que debes corregir:\n${input.feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  const res = await llm.generate({
    key: `develop:${task.position}:${input.attempt}`,
    schema: DevelopOutput,
    system: DEVELOP_SYSTEM,
    prompt: `Petición original del usuario: «${input.request}»

Tarea ${task.position}: ${task.title}
${task.description}
Ficheros previstos: ${task.files.join(", ")}
Criterios de aceptación que Testing comprobará:
${renderCriteria(task.acceptance)}${feedback}

Contenido actual de la web:

${renderSite(input.files)}`,
  });
  return { output: res.data, meta: meta(res) };
}

// ── Testing (revisión con LLM; los checks deterministas van aparte) ───────────

export const TESTING_SYSTEM = `Eres Testing, el agente de QA de un equipo de tres agentes de IA. Revisas la entrega de Develop para UNA tarea sobre una web estática.
Ya se han ejecutado comprobaciones automáticas (HTML válido, enlaces, formularios y criterios de aceptación) y te paso sus resultados. Tú revisas lo que no pueden comprobar: si la entrega cumple de verdad la tarea y la petición del usuario, si el contenido tiene sentido para esta web y es coherente con el resto de páginas, y la accesibilidad básica.

Reglas:
- severity "blocker" solo para problemas que impiden dar la tarea por cumplida. Estilo, redacción o mejoras opcionales son "minor".
- No repitas fallos que ya hayan detectado las comprobaciones automáticas.
- verdict "pass" si no hay ningún blocker.
- En español y conciso.`;

export interface ReviewInput {
  request: string;
  task: PlannedTask & { position: number };
  attempt: number;
  before: SiteFiles;
  after: SiteFiles;
  report: CheckReport;
}

export async function reviewDelivery(llm: LLMProvider, input: ReviewInput) {
  const { task, before, after, report } = input;
  const changed = Object.keys(after).filter((p) => before[p] !== after[p]);
  const unchanged = Object.keys(after).filter((p) => before[p] === after[p]);
  const failed = report.results.filter((r) => !r.passed);
  const res = await llm.generate({
    key: `review:${task.position}:${input.attempt}`,
    schema: ReviewOutput,
    system: TESTING_SYSTEM,
    prompt: `Petición original del usuario: «${input.request}»

Tarea ${task.position}: ${task.title}
${task.description}
Criterios de aceptación:
${renderCriteria(task.acceptance)}

Comprobaciones automáticas: ${report.results.length - failed.length}/${report.results.length} superadas.${
      failed.length ? `\nFallidas:\n${failed.map((r) => `- ${r.label}: ${r.details.join("; ")}`).join("\n")}` : ""
    }

Ficheros sin cambios: ${unchanged.join(", ") || "ninguno"}

Ficheros creados o modificados en esta entrega:

${renderSite(Object.fromEntries(changed.map((p) => [p, after[p]])))}`,
  });
  return { review: res.data, meta: meta(res) };
}
