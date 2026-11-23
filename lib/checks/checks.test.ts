import { describe, expect, it } from "vitest";
import { loadTemplate } from "@/lib/domain/template";
import type { Criterion } from "@/lib/domain/schemas";
import { runChecks } from "./index";
import { cssProblems, nestingProblems, resolveHref } from "./html";

const page = (body: string, { title = "Contacto", lang = "es" } = {}) => `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="styles.css"></head>
<body>${body}</body>
</html>`;

const goodForm = `
<nav><a href="index.html">Inicio</a> <a href="contacto.html">Contacto</a></nav>
<main><h1>Contacto</h1>
<form action="#" method="post">
  <label for="nombre">Nombre</label><input id="nombre" name="nombre" required>
  <label for="email">Correo</label><input id="email" name="email" type="email" required>
  <label>Mensaje <textarea name="mensaje"></textarea></label>
  <button type="submit">Enviar</button>
</form></main>`;

const site = (contact: string) => ({ ...loadTemplate(), "contacto.html": contact });

const failedIds = (files: Record<string, string>, criteria: Criterion[] = []) =>
  runChecks(files, criteria)
    .results.filter((r) => !r.passed)
    .map((r) => r.id);

describe("global checks", () => {
  it("the demo template passes every global check", () => {
    const report = runChecks(loadTemplate());
    expect(report.results.filter((r) => !r.passed)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("reports unclosed and misnested tags with their position", () => {
    const report = runChecks({ ...loadTemplate(), "contacto.html": page("<main><div><p>Hola</main>") });
    const parse = report.results.find((r) => r.id === "parse:contacto.html")!;
    expect(parse.passed).toBe(false);
    expect(parse.details.join(" ")).toMatch(/línea \d+/);
  });

  it("reports a missing title and lang", () => {
    const html = page("<p>x</p>", { title: "", lang: "" });
    const meta = runChecks({ ...loadTemplate(), "contacto.html": html }).results.find((r) => r.id === "meta:contacto.html")!;
    expect(meta.details).toEqual(["falta <title>", "falta el atributo lang en <html>"]);
  });

  it("detects broken, absolute and javascript: links and missing anchors", () => {
    const html = page(
      `<a href="precios.html">a</a><a href="/index.html">b</a><a href="javascript:void(0)">c</a><a href="#mapa">d</a>`,
    );
    const links = runChecks(site(html)).results.find((r) => r.id === "links:contacto.html")!;
    expect(links.details).toHaveLength(4);
  });

  it("accepts external, mailto, tel and existing anchor links", () => {
    const html = page(
      `<a href="https://maps.google.com">m</a><a href="mailto:hola@laespiga.es">e</a><a href="tel:+34960000000">t</a><a href="#top">x</a><span id="top"></span>`,
    );
    expect(failedIds(site(html))).toEqual([]);
  });

  it("detects a stylesheet that does not exist", () => {
    const html = page("<p>x</p>").replace("styles.css", "contacto.css");
    expect(failedIds(site(html))).toContain("links:contacto.html");
  });

  it("validates CSS brace balance, ignoring comments and strings", () => {
    expect(cssProblems(`a { content: "}"; } /* { */`)).toEqual([]);
    expect(cssProblems("a { color: red;")).toEqual(["faltan 1 llave(s) '}' por cerrar"]);
    expect(cssProblems("a { } }")).toEqual(["hay una llave '}' de más"]);
  });
});

describe("form checks", () => {
  it("a labelled form with action, method, email type and submit passes", () => {
    expect(failedIds(site(page(goodForm)), [{ kind: "form_valid", path: "contacto.html" }])).toEqual([]);
  });

  it("reports every accessibility and validity problem", () => {
    const bad = page(`<form>
      <input id="nombre" name="nombre">
      <label for="correo">Correo</label><input id="correo" name="correo" type="text">
      <textarea id="msg"></textarea>
    </form>`);
    const r = runChecks(site(bad), [{ kind: "form_valid", path: "contacto.html" }]).results.find(
      (x) => x.id === "criterion:0",
    )!;
    expect(r.details).toEqual(
      expect.arrayContaining([
        "formulario 1: falta el atributo action",
        "formulario 1: method debe ser get o post",
        "formulario 1: campo nombre no tiene <label> asociada",
        'formulario 1: campo correo debería ser type="email"',
        "formulario 1: campo msg no tiene name",
        "formulario 1: no tiene botón de envío",
      ]),
    );
  });

  it("form_valid fails when the page has no form", () => {
    expect(failedIds(site(page("<p>Llámanos</p>")), [{ kind: "form_valid", path: "contacto.html" }])).toEqual([
      "criterion:0",
    ]);
  });
});

describe("acceptance criteria", () => {
  const files = site(page(goodForm));

  it("passes a full contact-page plan", () => {
    const criteria: Criterion[] = [
      { kind: "file_exists", path: "contacto.html" },
      { kind: "selector", path: "contacto.html", selector: "form input", min: 2 },
      { kind: "text_contains", path: "contacto.html", text: "  contacto " },
      { kind: "link_exists", from: "contacto.html", to: "index.html" },
      { kind: "links_valid" },
    ];
    expect(failedIds(files, criteria)).toEqual([]);
  });

  it("fails when the new page is not linked from the home navigation", () => {
    expect(failedIds(files, [{ kind: "link_exists", from: "index.html", to: "contacto.html" }])).toEqual([
      "criterion:0",
    ]);
  });

  it("reports a missing file, a selector count and an invalid selector", () => {
    const r = runChecks(files, [
      { kind: "file_exists", path: "precios.html" },
      { kind: "selector", path: "contacto.html", selector: "form", min: 2 },
      { kind: "selector", path: "contacto.html", selector: "form[", min: 1 },
    ]).results.filter((x) => x.id.startsWith("criterion:"));
    expect(r.map((x) => x.details[0])).toEqual([
      "el fichero precios.html no existe",
      "encontrados 1, se esperaban al menos 2",
      "selector CSS no válido: form[",
    ]);
  });
});

describe("nestingProblems", () => {
  const codes = (html: string) => nestingProblems(html).map((p) => `${p.line}:${p.code}`);

  it("reports unclosed, stray and misnested tags with their line", () => {
    expect(codes("<main>\n<div>\n<span>x</div>\n</main>")).toEqual(["3:<span> sin cerrar antes de </div>"]);
    expect(codes("<div></div></section>")).toEqual(["1:cierre </section> sin etiqueta de apertura"]);
    expect(codes("<div>\n<form>")).toEqual(["1:<div> sin cerrar", "2:<form> sin cerrar"]);
  });

  it("allows void, self-closing and optional-end elements", () => {
    expect(codes(`<ul><li>a<li>b</ul><p>x<br><img src="a.svg"><svg><path d="M0"/></svg>`)).toEqual([]);
  });

  it("ignores tags inside comments, scripts, styles and attribute values", () => {
    expect(codes(`<!-- <div> --><style>a>b{}</style><script>if (a<b) "</p>"</script><a title="<b>">x</a>`)).toEqual([]);
  });
});

describe("resolveHref", () => {
  it("resolves relative paths like the preview iframe", () => {
    expect(resolveHref("blog/post.html", "../index.html")).toEqual({ kind: "internal", path: "index.html" });
    expect(resolveHref("index.html", "contacto.html?x=1#form")).toEqual({ kind: "internal", path: "contacto.html" });
    expect(resolveHref("index.html", "./")).toEqual({ kind: "internal", path: "index.html" });
    expect(resolveHref("index.html", "../../etc/passwd").kind).toBe("invalid");
  });
});
