import { parseStructured, toProviderSchema } from "./json-schema";
import {
  LLMOutputError,
  LLMUnavailableError,
  type GenerateRequest,
  type GenerateResult,
  type LLMProvider,
} from "./types";

/** Production model with strict `json_schema` support on Groq (docs checked 2026-11-23). */
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MAX_WAIT_MS = 15_000;

export interface GroqOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly retryAfterMs: number | null,
  ) {
    super(`Groq ${status}: ${body.slice(0, 300)}`);
  }
}

/** Groq's OpenAI-compatible API with Structured Outputs; strict mode, best-effort if the schema is refused. */
export class GroqProvider implements LLMProvider {
  readonly name = "groq" as const;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: GroqOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("Falta GROQ_API_KEY");
    this.apiKey = apiKey;
    this.model = opts.model ?? process.env.GROQ_MODEL ?? GROQ_DEFAULT_MODEL;
    this.timeoutMs = opts.timeoutMs ?? 75_000;
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const schema = toProviderSchema(req.schema);
    const started = Date.now();
    let strict = true;
    let prompt = req.prompt;
    let validationRetried = false;
    let waited = false;

    while (true) {
      try {
        const res = await this.call(req.system, prompt, schema, strict);
        const parsed = parseStructured(res.text, req.schema);
        if (parsed.ok) {
          return {
            data: parsed.data,
            provider: this.name,
            model: this.model,
            latencyMs: Date.now() - started,
            fallback: false,
            usage: res.usage,
          };
        }
        if (validationRetried) throw new LLMOutputError(`${this.model}: salida no válida tras reintento: ${parsed.error}`);
        validationRetried = true;
        prompt = `${req.prompt}\n\nTu respuesta anterior no cumplía el esquema:\n${parsed.error}\nDevuelve de nuevo la respuesta completa corrigiendo esos errores.`;
      } catch (err) {
        if (err instanceof HttpError && err.status === 400 && strict && /schema/i.test(err.body)) {
          strict = false; // strict mode refused this schema: best-effort, still validated with zod
          continue;
        }
        if (err instanceof HttpError && (err.status === 429 || err.status >= 500)) {
          const wait = err.retryAfterMs ?? 3_000;
          if (!waited && wait <= MAX_WAIT_MS) {
            waited = true;
            await this.sleep(wait);
            continue;
          }
          throw new LLMUnavailableError(`Groq no disponible: ${err.status === 429 ? "límite de uso (429)" : `servicio caído (${err.status})`}`);
        }
        if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))
          throw new LLMUnavailableError("Groq no disponible: sin respuesta a tiempo");
        throw err;
      }
    }
  }

  private async call(system: string, prompt: string, schema: object, strict: boolean) {
    const res = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_schema", json_schema: { name: "respuesta", strict, schema } },
      }),
    });
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new HttpError(res.status, await res.text(), Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices?.[0]?.message?.content,
      usage: { inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens },
    };
  }
}
