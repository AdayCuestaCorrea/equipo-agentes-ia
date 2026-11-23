import { z } from "zod";
import {
  LLMOutputError,
  ReplayMissingError,
  type GenerateRequest,
  type GenerateResult,
  type LLMProvider,
} from "./types";

/** Recorded LLM answers keyed by step key ("plan", "develop:1:1", "review:1:1"…). */
export type Recording = Record<string, unknown>;

/**
 * Replays recorded answers so a run works with no LLM quota at all. Only the model's
 * answers are recorded: deterministic checks, versions and the loop still run for real.
 */
export class DemoProvider implements LLMProvider {
  readonly name = "demo" as const;

  constructor(
    private readonly recording: Recording,
    private readonly delayMs = 0,
  ) {}

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    if (!(req.key in this.recording)) throw new ReplayMissingError(`No hay respuesta grabada para «${req.key}»`);
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    const parsed = req.schema.safeParse(this.recording[req.key]);
    if (!parsed.success) throw new LLMOutputError(`Grabación no válida para «${req.key}»: ${z.prettifyError(parsed.error)}`);
    return { data: parsed.data, provider: this.name, model: "grabado", latencyMs: this.delayMs, fallback: false };
  }
}

/** Wraps a live provider and keeps every answer, to produce a demo recording from a real run. */
export class RecordingProvider implements LLMProvider {
  readonly recording: Recording = {};

  constructor(private readonly inner: LLMProvider) {}

  get name() {
    return this.inner.name;
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const res = await this.inner.generate(req);
    this.recording[req.key] = res.data;
    return res;
  }
}
