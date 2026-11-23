import { describe, expect, it } from "vitest";
import { agentViews, durationLabel, modelLabel, pagesAt, versionViews, type RunSnapshot } from "./snapshot";

const base: RunSnapshot = {
  run: {
    id: "r",
    prompt: "añade una página de contacto",
    status: "running",
    mode: "live",
    currentVersion: 1,
    error: null,
    isShowcase: false,
    createdAt: "2026-11-23T10:00:00Z",
    finishedAt: null,
  },
  tasks: [
    { id: "t1", position: 1, title: "Crear contacto", description: "d", files: [], acceptance: [], status: "testing", attempts: 1, maxAttempts: 3 },
  ],
  events: [
    { id: 1, taskId: null, agent: "orchestrator", type: "state", message: "Repartiendo", data: { state: "waiting" }, provider: null, model: null, latencyMs: null, createdAt: "" },
    { id: 2, taskId: "t1", agent: "develop", type: "llm_call", message: "Entrega v1", data: { fallback: true }, provider: "gemini", model: "gemini-3.5-flash-lite", latencyMs: 9000, createdAt: "" },
    { id: 3, taskId: "t1", agent: "testing", type: "state", message: "Probando", data: { state: "working" }, provider: null, model: null, latencyMs: null, createdAt: "" },
  ],
  messages: [
    { id: 1, taskId: "t1", from: "develop", to: "testing", kind: "delivery", body: { version: 1, attempt: 1, changed: [{ path: "contacto.html", isNew: true }] }, createdAt: "" },
  ],
};

describe("run page derivations", () => {
  it("derives each agent's state from its last state event", () => {
    const [o, d, t] = agentViews(base);
    expect([o.state, d.state, t.state]).toEqual(["waiting", "idle", "working"]);
    expect(d.providers).toEqual(["Gemini · 3.5-flash-lite (respaldo)"]);
  });

  it("marks every agent done or stopped when the run ends", () => {
    expect(agentViews({ ...base, run: { ...base.run, status: "done" } }).map((a) => a.state)).toEqual(["done", "done", "done"]);
    expect(agentViews({ ...base, run: { ...base.run, status: "failed" } })[0].state).toBe("error");
  });

  it("lists versions from deliveries and the pages each one has", () => {
    const versions = versionViews(base);
    expect(versions.map((v) => v.label)).toEqual(["v0 · web original", "v1 · tarea 1, intento 1"]);
    expect(pagesAt(versions, 0)).toEqual(["index.html", "nosotros.html"]);
    expect(pagesAt(versions, 1)).toEqual(["index.html", "contacto.html", "nosotros.html"]);
  });

  it("formats model and duration labels", () => {
    expect(modelLabel("groq", "openai/gpt-oss-120b")).toBe("Groq · gpt-oss-120b");
    expect(modelLabel("demo", "grabado")).toBe("Demo (respuestas grabadas)");
    expect(durationLabel("2026-11-23T10:00:00Z", "2026-11-23T10:01:51Z")).toBe("1 min 51 s");
  });
});
