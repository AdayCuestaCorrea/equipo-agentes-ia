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

/** Live provider chain from the environment: Gemini first, then Groq, whichever have a key. */
export function createLiveProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const chain: LLMProvider[] = [];
  // With a backup provider, Gemini gets a shorter budget so both fit in one Vercel step (300 s).
  const budgetMs = env.GROQ_API_KEY ? 150_000 : 200_000;
  if (env.GEMINI_API_KEY) chain.push(new GeminiProvider({ apiKey: env.GEMINI_API_KEY, budgetMs }));
  if (env.GROQ_API_KEY) chain.push(new GroqProvider({ apiKey: env.GROQ_API_KEY }));
  return chain.length === 1 ? chain[0] : new FallbackProvider(chain);
}
