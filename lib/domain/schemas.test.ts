import { describe, expect, it } from "vitest";
import { Criterion, DevelopOutput, FilePath, Plan } from "./schemas";

describe("FilePath", () => {
  it.each(["index.html", "contacto.html", "css/site-2.css", "img/logo.svg"])("accepts %s", (p) => {
    expect(FilePath.safeParse(p).success).toBe(true);
  });
  it.each(["../x.html", "/index.html", "Index.html", "app.js", "a/../b.html", "", "dir/"])("rejects %s", (p) => {
    expect(FilePath.safeParse(p).success).toBe(false);
  });
});

describe("Plan", () => {
  const plan = {
    summary: "Añadir página de contacto",
    tasks: [
      {
        title: "Crear contacto.html",
        description: "Página con formulario de contacto accesible.",
        files: ["contacto.html"],
        acceptance: [{ kind: "selector", path: "contacto.html", selector: "form" }],
      },
    ],
  };

  it("accepts a valid plan and defaults selector min to 1", () => {
    const parsed = Plan.parse(plan);
    expect(parsed.tasks[0].acceptance[0]).toEqual({
      kind: "selector",
      path: "contacto.html",
      selector: "form",
      min: 1,
    });
  });

  it("rejects plans without tasks or with unknown criteria", () => {
    expect(Plan.safeParse({ ...plan, tasks: [] }).success).toBe(false);
    expect(Criterion.safeParse({ kind: "screenshot_matches", path: "index.html" }).success).toBe(false);
  });
});

describe("DevelopOutput", () => {
  it("rejects duplicated files in one delivery", () => {
    const f = { path: "contacto.html", content: "<p>x</p>" };
    expect(DevelopOutput.safeParse({ summary: "Entrega", files: [f, f] }).success).toBe(false);
  });
});
