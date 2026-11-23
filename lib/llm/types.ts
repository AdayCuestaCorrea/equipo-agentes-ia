import type { z } from "zod";

export type ProviderName = "gemini" | "groq" | "demo";

export interface GenerateRequest<T> {
  /** Stable id of the step (e.g. "plan", "develop:1:2"); used to record and replay demo runs. */
  key: string;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
}

export interface GenerateResult<T> {
  data: T;
  provider: ProviderName;
  model: string;
  latencyMs: number;
  /** True when the primary model was unavailable and a fallback answered. */
  fallback: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LLMProvider {
  readonly name: ProviderName;
  generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>>;
}

/** Every model of the provider is rate-limited, out of quota, down or timing out. */
export class LLMUnavailableError extends Error {
  readonly name = "LLMUnavailableError";
}

/** The model answered, but not with JSON matching the schema, even after a corrective retry. */
export class LLMOutputError extends Error {
  readonly name = "LLMOutputError";
}

/** Demo mode has no recorded answer for this step. */
export class ReplayMissingError extends Error {
  readonly name = "ReplayMissingError";
}
