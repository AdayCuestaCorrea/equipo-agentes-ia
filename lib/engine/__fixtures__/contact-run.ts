import { loadTemplate } from "@/lib/domain/template";
import type { PlanLLM } from "@/lib/agents";
import type { Recording } from "@/lib/llm/demo";

/**
 * Hand-written recording of "añade una página de contacto": the first delivery of task 1
 * has an unlabelled field, so Testing rejects it and Develop fixes it on attempt 2.
 */
const t = loadTemplate();
const navLink = '<li><a href="contacto.html">Contacto</a></li>';
const withContactNav = (html: string) => html.replace("</ul>\n    </nav>", `  ${navLink}\n      </ul>\n    </nav>`);

const contact = (labelled: boolean) =>
  withContactNav(t["nosotros.html"])
    .replace("<title>Nosotros · Panadería La Espiga</title>", "<title>Contacto · Panadería La Espiga</title>")
    .replace(' aria-current="page">Nosotros', ">Nosotros")
    .replace('<a href="contacto.html">', '<a href="contacto.html" aria-current="page">')
    .replace(
      /<section class="page">[\s\S]*<\/section>/,
      `<section class="page">
      <h1>Contacto</h1>
      <form action="#" method="post">
        <label for="nombre">Nombre</label>
        <input id="nombre" name="nombre" required>
        ${labelled ? '<label for="email">Correo electrónico</label>\n        ' : ""}<input id="email" name="email" type="email" required>
        <label for="mensaje">Mensaje</label>
        <textarea id="mensaje" name="mensaje" rows="4"></textarea>
        <button type="submit">Enviar</button>
      </form>
    </section>`,
    );

const criterion = (c: Partial<PlanLLM["tasks"][number]["acceptance"][number]>) => ({
  kind: "file_exists" as const,
  path: null,
  selector: null,
  text: null,
  from: null,
  to: null,
  min: null,
  ...c,
});

const plan: PlanLLM = {
  summary: "Crear contacto.html con un formulario accesible y enlazarla desde la navegación.",
  tasks: [
    {
      title: "Crear la página de contacto",
      description: "Crear contacto.html con la cabecera y el pie del sitio y un formulario de nombre, email y mensaje.",
      files: ["contacto.html"],
      acceptance: [
        criterion({ kind: "file_exists", path: "contacto.html" }),
        criterion({ kind: "form_valid", path: "contacto.html" }),
        criterion({ kind: "selector", path: "contacto.html", selector: "textarea", min: 1 }),
        criterion({ kind: "link_exists", from: "contacto.html", to: "index.html" }),
      ],
    },
    {
      title: "Enlazar Contacto en la navegación",
      description: "Añadir el enlace a contacto.html en el menú de index.html y nosotros.html.",
      files: ["index.html", "nosotros.html"],
      acceptance: [
        criterion({ kind: "link_exists", from: "index.html", to: "contacto.html" }),
        criterion({ kind: "link_exists", from: "nosotros.html", to: "contacto.html" }),
        criterion({ kind: "links_valid" }),
      ],
    },
  ],
};

const pass = (summary: string) => ({ verdict: "pass", summary, issues: [] });

export const contactRecording: Recording = {
  plan,
  "develop:1:1": { summary: "Creada contacto.html con formulario.", files: [{ path: "contacto.html", content: contact(false) }] },
  "review:1:1": pass("La página cumple la tarea."),
  "develop:1:2": {
    summary: "Añadida la etiqueta del campo email.",
    files: [{ path: "contacto.html", content: contact(true) }],
  },
  "review:1:2": pass("Formulario correcto y coherente con el sitio."),
  "develop:2:1": {
    summary: "Añadido Contacto al menú de inicio y nosotros.",
    files: [
      { path: "index.html", content: withContactNav(t["index.html"]) },
      { path: "nosotros.html", content: withContactNav(t["nosotros.html"]) },
    ],
  },
  "review:2:1": {
    verdict: "pass",
    summary: "Navegación coherente en todas las páginas.",
    issues: [{ severity: "minor", file: "index.html", detail: "Podría destacarse el enlace en móvil." }],
  },
};
