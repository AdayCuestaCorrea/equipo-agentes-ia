import { GeminiProvider } from "./gemini";
import { GroqProvider } from "./groq";
import { LLMUnavailableError, type GenerateRequest, type GenerateResult, type LLMProvider, type ProviderName } from "./types";

/**
 * Tries providers in order; moves to the next only when one is unavailable (quota, outage,
 * timeout). Output errors are not hidden by switching provider.
 */
export class FallbackProvider implements LLMProvider {
  constructor(private readonly providers: LLMProvider[]) {
    if (providers.length === 0) throw new Error("No hay ningún proveedor de LLM configurado");
  }

  get name(): ProviderName {
    return this.providers[0].name;
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const reasons: string[] = [];
    for (const [i, p] of this.providers.entries()) {
      try {
        const res = await p.generate(req);
        return i > 0 ? { ...res, fallback: true } : res;
      } catch (err) {
        if (!(err instanceof LLMUnavailableError)) throw err;
        reasons.push(err.message);
      }
    }
    throw new LLMUnavailableError(reasons.join(" | "));
  }
}

/**
 * Live provider chain from the environment. Order comes from LLM_ORDER (default "groq,gemini":
 * Groq answered in 1–6 s vs 18–66 s for Gemini Flash-Lite, which also returned frequent 503s).
 * Providers without an API key are skipped.
 */
export function createLiveProvider(env: Record<string, string | undefined> = process.env): LLMProvider {
  const order = (env.LLM_ORDER ?? "groq,gemini").split(",").map((s) => s.trim().toLowerCase());
  const factories: Record<string, (() => LLMProvider) | undefined> = {
    groq: env.GROQ_API_KEY ? () => new GroqProvider({ apiKey: env.GROQ_API_KEY }) : undefined,
    // Shorter budget when another provider may follow, so both fit in one Vercel step (300 s).
    gemini: env.GEMINI_API_KEY ? () => new GeminiProvider({ apiKey: env.GEMINI_API_KEY, budgetMs: 150_000 }) : undefined,
  };
  const chain = [...new Set(order)].flatMap((name) => factories[name]?.() ?? []);
  return chain.length === 1 ? chain[0] : new FallbackProvider(chain);
}
