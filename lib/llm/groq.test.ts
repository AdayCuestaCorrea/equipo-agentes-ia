import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FallbackProvider } from "./index";
import { GroqProvider } from "./groq";
import { DemoProvider } from "./demo";
import { LLMOutputError, LLMUnavailableError, type LLMProvider } from "./types";

const Schema = z.object({ ok: z.boolean() });
const req = { key: "k", schema: Schema, system: "s", prompt: "p" };
const sleep = async () => {};

const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), {
    status: 200,
  });
const error = (status: number, body = "error", headers: Record<string, string> = {}) => new Response(body, { status, headers });

function groq(...responses: Response[]) {
  const f = vi.fn(async () => responses.shift()!);
  return { p: new GroqProvider({ apiKey: "test", fetch: f as unknown as typeof fetch, sleep }), f };
}
const body = (f: ReturnType<typeof vi.fn>, i: number) => JSON.parse((f.mock.calls[i] as [string, RequestInit])[1].body as string);

describe("GroqProvider", () => {
  it("requests strict json_schema output and validates it", async () => {
    const { p, f } = groq(reply('{"ok":true}'));
    await expect(p.generate(req)).resolves.toMatchObject({ data: { ok: true }, provider: "groq", usage: { inputTokens: 3 } });
    expect(body(f, 0).response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
  });

  it("falls back to best-effort mode when strict mode refuses the schema", async () => {
    const { p, f } = groq(error(400, '{"error":{"message":"invalid JSON schema for strict mode"}}'), reply('{"ok":false}'));
    await expect(p.generate(req)).resolves.toMatchObject({ data: { ok: false } });
    expect(body(f, 1).response_format.json_schema.strict).toBe(false);
  });

  it("waits retry-after once on 429, then reports it as unavailable", async () => {
    const ok = groq(error(429, "rate", { "retry-after": "2" }), reply('{"ok":true}'));
    await expect(ok.p.generate(req)).resolves.toMatchObject({ data: { ok: true } });
    const ko = groq(error(429, "rate"), error(429, "rate"));
    await expect(ko.p.generate(req)).rejects.toBeInstanceOf(LLMUnavailableError);
  });

  it("retries invalid output once with the validation error", async () => {
    const { p } = groq(reply('{"ok":"x"}'), reply("no json"));
    await expect(p.generate(req)).rejects.toBeInstanceOf(LLMOutputError);
  });
});

describe("FallbackProvider", () => {
  const down: LLMProvider = {
    name: "gemini",
    generate: async () => {
      throw new LLMUnavailableError("503");
    },
  };

  it("uses the next provider only when the previous one is unavailable, marking the fallback", async () => {
    const res = await new FallbackProvider([down, new DemoProvider({ k: { ok: true } })]).generate(req);
    expect(res).toMatchObject({ provider: "demo", fallback: true });
  });

  it("does not switch provider on output errors", async () => {
    const broken = new DemoProvider({ k: { ok: "x" } });
    await expect(new FallbackProvider([broken, new DemoProvider({ k: { ok: true } })]).generate(req)).rejects.toBeInstanceOf(
      LLMOutputError,
    );
  });

  it("reports every provider's reason when all are down", async () => {
    await expect(new FallbackProvider([down, down]).generate(req)).rejects.toThrow("503 | 503");
  });
});

describe("createLiveProvider", () => {
  it("orders providers by LLM_ORDER and skips those without a key", async () => {
    const { createLiveProvider } = await import("./index");
    expect(createLiveProvider({ GROQ_API_KEY: "g", GEMINI_API_KEY: "x" }).name).toBe("groq");
    expect(createLiveProvider({ GROQ_API_KEY: "g", GEMINI_API_KEY: "x", LLM_ORDER: "gemini,groq" }).name).toBe("gemini");
    expect(createLiveProvider({ GEMINI_API_KEY: "x" }).name).toBe("gemini");
    expect(() => createLiveProvider({})).toThrow(/ningún proveedor/);
  });
});
