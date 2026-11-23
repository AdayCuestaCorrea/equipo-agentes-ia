import { z } from "zod";

type Json = { [k: string]: unknown };

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * JSON Schema for structured-output APIs (Gemini's `responseJsonSchema`, OpenAI-style providers).
 * zod emits `anyOf: [X, {type: "null"}]` for some nullables and `Number.MAX_SAFE_INTEGER` bounds;
 * both are rewritten to the simpler subset providers document. Array bounds are dropped: Gemini
 * compiles them into its decoder and rejects the plan schema with "too many states" (seen live).
 * Output is always re-validated with zod, so no constraint is lost.
 */
export function toProviderSchema(schema: z.ZodType): Json {
  const { $schema: _ignored, ...root } = z.toJSONSchema(schema) as Json;
  return simplify(root) as Json;
}

function simplify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplify);
  if (!isObj(node)) return node;

  const anyOf = node.anyOf;
  if (Array.isArray(anyOf) && anyOf.length === 2) {
    const nonNull = anyOf.find((s) => !(isObj(s) && s.type === "null"));
    if (isObj(nonNull) && typeof nonNull.type === "string" && anyOf.some((s) => isObj(s) && s.type === "null")) {
      const { anyOf: _a, ...rest } = node;
      return simplify({ ...rest, ...nonNull, type: [nonNull.type, "null"] });
    }
  }

  const out: Json = {};
  for (const [k, v] of Object.entries(node)) {
    if ((k === "maximum" || k === "minimum") && typeof v === "number" && Math.abs(v) >= Number.MAX_SAFE_INTEGER) continue;
    if (k === "minItems" || k === "maxItems") continue;
    out[k] = simplify(v);
  }
  return out;
}

/** Parses a model's text answer as JSON (tolerating ```json fences) and validates it with zod. */
export function parseStructured<T>(text: string | undefined, schema: z.ZodType<T>): { ok: true; data: T } | { ok: false; error: string } {
  if (!text?.trim()) return { ok: false, error: "Respuesta vacía" };
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: "La respuesta no es JSON válido" };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, error: z.prettifyError(parsed.error) };
}
