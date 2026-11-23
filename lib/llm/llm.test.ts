import { ApiError } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { normalizePlan, PlanLLM } from "@/lib/agents";
import { DemoProvider, RecordingProvider } from "./demo";
import { GeminiProvider, type GeminiClient } from "./gemini";
import { parseStructured, toProviderSchema } from "./json-schema";
import { LLMOutputError, LLMUnavailableError, ReplayMissingError } from "./types";

const Schema = z.object({ ok: z.boolean(), n: z.number().int().min(1).nullable() });
const req = { key: "k", schema: Schema, system: "s", prompt: "p" };

function client(...answers: (string | Error)[]) {
  const generateContent = vi.fn(async () => {
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return { text: a, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
  });
  return { c: { models: { generateContent } } as unknown as GeminiClient, generateContent };
}

describe("toProviderSchema", () => {
  it("rewrites nullable anyOf into type arrays and drops MAX_SAFE_INTEGER bounds", () => {
    const s = toProviderSchema(Schema) as { properties: Record<string, unknown>; $schema?: string };
    expect(s.$schema).toBeUndefined();
    expect(s.properties.n).toEqual({ type: ["integer", "null"], minimum: 1 });
    expect(JSON.stringify(toProviderSchema(PlanLLM))).not.toMatch(/anyOf|9007199254740991/);
  });
});

describe("parseStructured", () => {
  it("accepts fenced JSON and reports schema errors", () => {
    expect(parseStructured('```json\n{"ok":true,"n":null}\n```', Schema)).toEqual({ ok: true, data: { ok: true, n: null } });
    expect(parseStructured("hola", Schema)).toMatchObject({ ok: false });
    expect(parseStructured('{"ok":"si","n":0}', Schema)).toMatchObject({ ok: false });
  });
});

describe("GeminiProvider", () => {
  it("sends the JSON schema and returns validated data with metadata", async () => {
    const { c, generateContent } = client('{"ok":true,"n":2}');
    const res = await new GeminiProvider({ client: c, model: "m1", fallbackModel: "m2" }).generate(req);
    expect(res).toMatchObject({ data: { ok: true, n: 2 }, provider: "gemini", model: "m1", fallback: false });
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    const params = (generateContent.mock.calls[0] as unknown as [{ config: Record<string, unknown> }])[0];
    expect(params.config).toMatchObject({ responseMimeType: "application/json", systemInstruction: "s" });
  });

  it("retries once with the validation error, then gives up", async () => {
    const { c, generateContent } = client('{"ok":1}', '{"ok":true,"n":null}');
    await expect(new GeminiProvider({ client: c, model: "m1", fallbackModel: "m1" }).generate(req)).resolves.toMatchObject({
      data: { ok: true },
    });
    const second = (generateContent.mock.calls[1] as unknown as [{ contents: string }])[0];
    expect(second.contents).toMatch(/no cumplía el esquema/);

    const bad = client('{"ok":1}', "{}");
    await expect(new GeminiProvider({ client: bad.c, model: "m1", fallbackModel: "m1" }).generate(req)).rejects.toBeInstanceOf(
      LLMOutputError,
    );
  });

  it("falls back to the second model on 429 and reports it", async () => {
    const { c } = client(new ApiError({ message: "quota", status: 429 }), '{"ok":true,"n":null}');
    const res = await new GeminiProvider({ client: c, model: "m1", fallbackModel: "m2" }).generate(req);
    expect(res).toMatchObject({ model: "m2", fallback: true });
  });

  it("raises LLMUnavailableError when every model is out of quota", async () => {
    const e = () => new ApiError({ message: "quota", status: 429 });
    const { c } = client(e(), e());
    await expect(new GeminiProvider({ client: c, model: "m1", fallbackModel: "m2" }).generate(req)).rejects.toBeInstanceOf(
      LLMUnavailableError,
    );
  });

  it("does not hide other API errors such as an invalid key", async () => {
    const { c } = client(new ApiError({ message: "API key not valid", status: 400 }));
    await expect(new GeminiProvider({ client: c, model: "m1", fallbackModel: "m2" }).generate(req)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("DemoProvider and RecordingProvider", () => {
  it("replays by key, validates, and fails clearly when a key is missing", async () => {
    const demo = new DemoProvider({ k: { ok: true, n: null } });
    await expect(demo.generate(req)).resolves.toMatchObject({ provider: "demo", model: "grabado", data: { ok: true } });
    await expect(demo.generate({ ...req, key: "otra" })).rejects.toBeInstanceOf(ReplayMissingError);
    await expect(new DemoProvider({ k: { ok: "x" } }).generate(req)).rejects.toBeInstanceOf(LLMOutputError);
  });

  it("records what the inner provider answered", async () => {
    const rec = new RecordingProvider(new DemoProvider({ k: { ok: true, n: 3 } }));
    await rec.generate(req);
    expect(rec.recording).toEqual({ k: { ok: true, n: 3 } });
  });
});

describe("normalizePlan", () => {
  const base = { kind: "file_exists" as const, path: null, selector: null, text: null, from: null, to: null, min: null };

  it("maps flat criteria to the strict union and drops unusable ones", () => {
    const { plan, warnings } = normalizePlan({
      summary: "Plan",
      tasks: [
        {
          title: "Crear contacto",
          description: "Crear la página de contacto.",
          files: ["contacto.html"],
          acceptance: [
            { ...base, kind: "selector", path: "contacto.html", selector: "form" },
            { ...base, kind: "link_exists", from: "index.html", to: null },
          ],
        },
      ],
    });
    expect(plan.tasks[0].acceptance).toEqual([{ kind: "selector", path: "contacto.html", selector: "form", min: 1 }]);
    expect(warnings).toHaveLength(1);
  });

  it("keeps a task checkable when all its criteria are dropped", () => {
    const { plan } = normalizePlan({
      summary: "Plan",
      tasks: [{ title: "Crear contacto", description: "Crear la página de contacto.", files: ["contacto.html"], acceptance: [{ ...base, path: "../x.html" }] }],
    });
    expect(plan.tasks[0].acceptance).toEqual([{ kind: "file_exists", path: "contacto.html" }]);
  });

  it("rejects a plan with invalid file paths", () => {
    expect(() =>
      normalizePlan({
        summary: "Plan",
        tasks: [{ title: "Crear contacto", description: "Crear la página de contacto.", files: ["/Contacto.HTML"], acceptance: [base] }],
      }),
    ).toThrow(LLMOutputError);
  });
});
