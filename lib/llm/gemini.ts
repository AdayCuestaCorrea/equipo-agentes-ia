import { ApiError, GoogleGenAI } from "@google/genai";
import { parseStructured, toProviderSchema } from "./json-schema";
import {
  LLMOutputError,
  LLMUnavailableError,
  type GenerateRequest,
  type GenerateResult,
  type LLMProvider,
} from "./types";

/** The subset of the @google/genai client this provider uses (injectable for tests). */
export interface GeminiClient {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    }): Promise<{ text?: string; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }>;
  };
}

export interface GeminiOptions {
  apiKey?: string;
  model?: string;
  fallbackModel?: string;
  timeoutMs?: number;
  client?: GeminiClient;
  /** Total time one generate() may spend across retries and models (keeps a step under Vercel's limit). */
  budgetMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Free-tier limits seen in AI Studio (2026-11-23): gemini-3.5-flash-lite 15 RPM / 500 RPD,
 * gemini-3.8-flash 5 RPM / 20 RPD. A run makes 7–19 calls, so Flash-Lite is the workhorse.
 */
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_FALLBACK_MODEL = "gemini-3.8-flash";

/** Transient server-side statuses: retry the same model with backoff. */
const TRANSIENT = new Set([500, 503, 504]);
/** Backoff before each retry of a transient error (2 retries per model). */
const BACKOFF_MS = [2_000, 6_000];
/** Longest per-minute rate-limit wait worth sleeping through inside one serverless step. */
const MAX_RATE_LIMIT_WAIT_MS = 15_000;

/** Seconds Google asks to wait (RetryInfo.retryDelay, e.g. "23s"), if present in the error. */
export function retryDelayMs(message: string): number | null {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

const isDailyQuota = (message: string) => /PerDay|per day|daily/i.test(message);
const isTimeout = (err: unknown) =>
  // AbortSignal.timeout() surfaces as TimeoutError or, through the SDK's fetch, AbortError.
  err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini" as const;
  private readonly client: GeminiClient;
  private readonly models: string[];
  private readonly timeoutMs: number;
  private readonly budgetMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: GeminiOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
    if (!opts.client && !apiKey) throw new Error("Falta GEMINI_API_KEY");
    this.client = opts.client ?? (new GoogleGenAI({ apiKey }) as unknown as GeminiClient);
    const primary = opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
    const fallback = opts.fallbackModel ?? process.env.GEMINI_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODEL;
    this.models = [...new Set([primary, fallback])];
    this.timeoutMs = opts.timeoutMs ?? 75_000;
    this.budgetMs = opts.budgetMs ?? 200_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const jsonSchema = toProviderSchema(req.schema);
    const reasons: string[] = [];
    const deadline = Date.now() + this.budgetMs;
    /** Sleeps only if the wait plus a full call still fits in the budget. */
    const waitIfAffordable = async (ms: number) => {
      if (Date.now() + ms + this.timeoutMs > deadline) return false;
      await this.sleep(ms);
      return true;
    };

    for (const [i, model] of this.models.entries()) {
      if (Date.now() >= deadline) break;
      const started = Date.now();
      let prompt = req.prompt;
      let validationRetried = false;
      let transientRetries = 0;
      let rateLimitRetried = false;

      while (true) {
        try {
          const res = await this.client.models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction: req.system,
              responseMimeType: "application/json",
              responseJsonSchema: jsonSchema,
              temperature: 0.2,
              abortSignal: AbortSignal.timeout(this.timeoutMs),
            },
          });
          const parsed = parseStructured(res.text, req.schema);
          if (parsed.ok) {
            return {
              data: parsed.data,
              provider: this.name,
              model,
              latencyMs: Date.now() - started,
              fallback: i > 0,
              usage: {
                inputTokens: res.usageMetadata?.promptTokenCount,
                outputTokens: res.usageMetadata?.candidatesTokenCount,
              },
            };
          }
          if (validationRetried) throw new LLMOutputError(`${model}: salida no válida tras reintento: ${parsed.error}`);
          // One corrective retry: the validation error is sent back to the model.
          validationRetried = true;
          prompt = `${req.prompt}\n\nTu respuesta anterior no cumplía el esquema:\n${parsed.error}\nDevuelve de nuevo la respuesta completa corrigiendo esos errores.`;
        } catch (err) {
          if (err instanceof ApiError && TRANSIENT.has(err.status) && transientRetries < BACKOFF_MS.length) {
            if (await waitIfAffordable(BACKOFF_MS[transientRetries++])) continue;
          }
          if (err instanceof ApiError && err.status === 429 && !rateLimitRetried && !isDailyQuota(err.message)) {
            const wait = retryDelayMs(err.message) ?? 5_000;
            rateLimitRetried = true;
            if (wait <= MAX_RATE_LIMIT_WAIT_MS && (await waitIfAffordable(wait))) continue;
          }
          if ((err instanceof ApiError && (err.status === 429 || TRANSIENT.has(err.status))) || isTimeout(err)) {
            reasons.push(`${model}: ${describe(err)}`);
            break; // next model
          }
          throw err;
        }
      }
    }
    throw new LLMUnavailableError(`Gemini no disponible. ${reasons.join(" · ")}`);
  }
}

function describe(err: unknown): string {
  if (isTimeout(err)) return "sin respuesta a tiempo";
  if (err instanceof ApiError) {
    if (err.status === 429) return isDailyQuota(err.message) ? "cuota diaria agotada (429)" : "límite por minuto (429)";
    return `servicio saturado o caído (${err.status})`;
  }
  return String(err);
}
