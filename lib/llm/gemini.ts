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
}

/** HTTP statuses meaning "this model is not available right now": try the fallback model. */
const UNAVAILABLE = new Set([429, 500, 503, 504]);

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini" as const;
  private readonly client: GeminiClient;
  private readonly models: string[];
  private readonly timeoutMs: number;

  constructor(opts: GeminiOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
    if (!opts.client && !apiKey) throw new Error("Falta GEMINI_API_KEY");
    this.client = opts.client ?? (new GoogleGenAI({ apiKey }) as unknown as GeminiClient);
    const primary = opts.model ?? process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
    const fallback = opts.fallbackModel ?? process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash-lite";
    this.models = [...new Set([primary, fallback])];
    this.timeoutMs = opts.timeoutMs ?? 90_000;
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const jsonSchema = toProviderSchema(req.schema);
    let lastUnavailable: unknown;

    for (const [i, model] of this.models.entries()) {
      const started = Date.now();
      try {
        let prompt = req.prompt;
        // One corrective retry: the validation error is sent back to the model.
        for (let attempt = 1; attempt <= 2; attempt++) {
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
          if (attempt === 2) throw new LLMOutputError(`${model}: salida no válida tras reintento: ${parsed.error}`);
          prompt = `${req.prompt}\n\nTu respuesta anterior no cumplía el esquema:\n${parsed.error}\nDevuelve de nuevo la respuesta completa corrigiendo esos errores.`;
        }
      } catch (err) {
        if (err instanceof ApiError && UNAVAILABLE.has(err.status)) {
          lastUnavailable = err;
          continue;
        }
        if (err instanceof Error && err.name === "TimeoutError") {
          lastUnavailable = err;
          continue;
        }
        throw err;
      }
    }
    const detail = lastUnavailable instanceof Error ? lastUnavailable.message : String(lastUnavailable);
    throw new LLMUnavailableError(`Gemini no disponible (${this.models.join(", ")}): ${detail}`);
  }
}
