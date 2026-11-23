# Notas de trabajo con Claude Code

Registro vivo para la sección «Cómo usé Claude Code» del README. Fechas en formato AAAA-MM-DD.

## 2026-11-23 — Planificación

- **Arranque**: le pasé el enunciado literal y mis restricciones (coste 0 €, ningún secreto en el repo, yo hago los logins). Le pedí preguntas antes que código.
- **Preguntas de Claude** (4): proveedor LLM, base de datos, acceso público o con login, y plazo.
- **Mis respuestas**:
  - Gemini como principal, con una capa de proveedor lista para Groq, y modo demo.
  - Supabase con Realtime y un cron diario para que no se pause.
  - Sin login se ve una ejecución completada en solo lectura; con el usuario de prueba se lanzan peticiones nuevas.
  - Plazo de 1–2 días.
- **Verificación de límites en la documentación oficial**, no de memoria (con subagentes de lectura web):
  - Vercel Hobby: 300 s por función con Fluid compute. `after()` comparte ese límite y el cron es diario.
  - Supabase Free: el proyecto se pausa tras 1 semana de inactividad. Realtime admite 200 conexiones.
  - Gemini: modelos con capa gratuita y salida con `responseJsonSchema`. Los RPM/RPD gratuitos solo aparecen en AI Studio con sesión iniciada, así que quedan pendientes de que yo los consulte.
- **Decisiones que propuso la IA y aprobé**:
  - Web demo estática (HTML/CSS) guardada por versiones en la BD, con vista previa real en un iframe.
  - Checks deterministas más revisión con LLM, con un máximo de 3 intentos por tarea.
  - Un paso del agente por invocación, con lease en la BD y encadenado con `after()`.
  - Motor como máquina de estados pura, testeable sin red.
- **Incidencia**: el modo automático bloqueó `npx create-next-app`, que descarga y ejecuta código remoto. El andamiaje lo lanzo yo a mano.

## 2026-11-23 — Fase 1: andamiaje

- `create-next-app` falló por las mayúsculas del nombre de la carpeta (restricción de npm). La IA propuso generarlo en una subcarpeta `agentes-speed` y mover el contenido. Lo ejecuté yo.
- Next.js 16 genera un `AGENTS.md` que avisa de cambios de API respecto a lo que conoce el modelo. Queda importado desde `CLAUDE.md` para que Claude lea la documentación incluida antes de escribir rutas.
- Vitest 5 no instalaba con `@types/node@20`. La IA lo subió a la 24, que es la versión de Node de Vercel.
- Mis permisos de Claude Code bloquean leer o escribir `.env*`. Creé `.env.example` a mano con el contenido que propuso la IA.

## 2026-11-23 — Fase 2: dominio puro

- **Checks deterministas** con parse5 (errores de parseo del estándar HTML, con línea y columna) y cheerio (selectores, enlaces, formularios). Los enlaces se resuelven igual que lo hará el iframe de la vista previa. Las rutas absolutas `/x.html` cuentan como error porque romperían la vista previa.
- **Decisión de la IA**: un intento cuenta cuando Develop *entrega*, no cuando empieza. Así un paso que se cae a medias y se reintenta no consume intentos.
- **Decisión de la IA**: si la revisión LLM devuelve `fail` pero sin issues bloqueantes, se cuenta como fallo usando su resumen. Si la revisión no está disponible, deciden solo los checks deterministas.
- Se añadió `step_count` a `runs` como tope global (50 pasos) para que ninguna ejecución pueda entrar en un bucle infinito.
- **Fallo detectado por un test**: daba por hecho que parse5 informaba de etiquetas sin cerrar o mal anidadas. En realidad solo informa de errores de tokenización y repara el árbol en silencio, como un navegador.
  - Lo descubrió el test «reports unclosed and misnested tags», escrito antes de comprobar la API.
  - La IA lo verificó con un script de prueba y añadió `nestingProblems`: una pila de etiquetas que respeta los elementos vacíos y los de cierre opcional, e ignora comentarios, `<script>`/`<style>` y atributos. Lleva tests propios para los falsos positivos.
  - Lección para el README: un check «el HTML parsea» no sirve de nada si el parser es tolerante.

## 2026-11-23 — Fase 3: agentes, LLM y motor

- **Diseño**:
  - Interfaz `LLMProvider`, con `GeminiProvider`, `DemoProvider` (reproduce respuestas grabadas) y `RecordingProvider` (graba una ejecución real).
  - Motor `runStep`: un paso por llamada, con lease, reintentos y tope de errores seguidos.
  - `MemoryRepo` para tests.
  - Test de ejecución completa en memoria: plan → fallo (input sin label) → corrección → integración.
- **Decisión de la IA**: para el LLM, los criterios del plan son objetos planos con campos `null` en vez de una unión discriminada (`anyOf` no figura entre las palabras clave que documenta Gemini). Se normalizan después al esquema estricto del dominio.
- **Fallo de diseño cazado al escribir un test**: los checks globales recorrían toda la web, así que una tarea fallida «contagiaba» a las siguientes. Ahora Testing solo aplica los checks globales a los ficheros que cambió cada tarea; la integración final sí revisa toda la web.
- **Primera ejecución real contra Gemini** (script `npm run record-demo`). Cuatro hallazgos:
  1. `400 schema produces a constraint that has too many states`: Gemini compila `minItems`/`maxItems` en su decodificador. Se quitan del esquema enviado y zod los sigue validando.
  2. `This operation was aborted`: el SDK convierte el timeout en un `AbortError`, que no se trataba como «modelo no disponible». Corregido.
  3. **Yo consulté los límites gratuitos en AI Studio**: gemini-3.8-flash permite 5 RPM y **20 RPD**; gemini-3.5-flash-lite, 15 RPM y 500 RPD. Con 7–19 llamadas por ejecución, 3.8 Flash daría para una ejecución al día. **Cambio de plan**: Flash-Lite pasa a ser el principal y 3.8 Flash el respaldo.
  4. 503 «high demand» persistentes en ambos modelos. Ahora hay backoff (2 s y 6 s), se respeta el `retryDelay` de los 429 por minuto y se salta al otro modelo si se agota la cuota diaria. Hay un presupuesto de 200 s por llamada para no pasar del límite de Vercel. El motor trata la indisponibilidad como error transitorio: 3 intentos y después `failed` con un mensaje claro.
- **Plan mal ordenado por el LLM**: puso «enlazar en el menú» antes de «crear la página», y esa tarea fallaría siempre en el check de enlaces. Se añadió al prompt del Orquestador que cada tarea se prueba nada más terminarla y que no puede depender de una posterior.
- **Respaldo con Groq adelantado** (decisión mía, tras ver los 503 persistentes de Gemini).
  - La IA verificó en la documentación de Groq que `openai/gpt-oss-120b` es de producción y admite `json_schema` estricto.
  - Yo consulté los límites: 30 RPM, 1K RPD, **8K TPM** y 200K TPD.
  - Cadena `FallbackProvider` Gemini → Groq. Solo se cambia de proveedor si el anterior no está disponible; un JSON inválido no se oculta cambiando de proveedor.
- **Primera ejecución real completa** («añade una página de contacto a esta web»): `done`, 3/3 tareas, 7 llamadas y 133 s.
  - El plan y la primera entrega los hizo Gemini Flash-Lite (18 s y 66 s); el resto, Groq (1–6 s por llamada), porque Gemini volvió a saturarse.
  - El formulario generado es correcto: labels, `type="email"` y `required`.
  - Sospeché que Develop había borrado contenido de `index.html` por su tamaño. Lo comprobé y no fue así.
- **Grabación del modo demo**: `fixtures/demo-run.json` sale de esa ejecución real. En ella, Testing aprobó todo al primer intento, así que la grabación real **no** muestra el bucle de corrección. El bucle está cubierto por el test con la grabación escrita a mano (`lib/engine/__fixtures__/contact-run.ts`).
- **Regrabación para buscar el bucle** (decisión mía): 4 ejecuciones reales, todas `done` y sin ninguna corrección. Con el prompt mejorado, Develop acierta a la primera.
  - Nos quedamos con una grabación real (la 1.ª: 3 tareas, 7 llamadas, 29,6 s con Groq) en vez de fabricar un fallo.
  - El bucle queda demostrado por los tests y por las ejecuciones en vivo cuando ocurra.
- **Orden de proveedores** (decisión mía, a propuesta de la IA): Groq → Gemini, configurable con `LLM_ORDER`. Groq tarda 1–20 s por llamada; Gemini Flash-Lite, 18–66 s, y da 503 frecuentes.
- **Hallazgo en las regrabaciones**: con ejecuciones seguidas, Groq devuelve 429 (8K tokens/min). En la app el siguiente paso se encadenaba al instante, así que 3 errores seguidos llegarían en segundos. Ahora hay una pausa de 20 s antes de reintentar un paso fallido.

## 2026-11-23 — Fase 4: persistencia y ejecución por HTTP

- **Script de humo** `npm run smoke -- demo|live`: inicia sesión con `@supabase/ssr` (cookies con el mismo formato que el navegador), crea la ejecución por HTTP, sigue los eventos en la BD y comprueba la vista previa. Las credenciales se pasan por variables de entorno; nunca se escriben en un fichero.
- **Primer fallo contra Supabase**: `permission denied for table runs` con la service role. No era RLS: las tablas creadas por SQL no tenían GRANT para los roles de la API.
  - Al revisarlo, la IA vio además un **fallo suyo**: 0001 quitaba a `PUBLIC` el permiso de ejecutar las funciones de lease sin dárselo a `service_role`.
  - Corregido con `0002_grants.sql`, que yo ejecuté.
- **Demo por HTTP**: `done` en 23 s, con 8 pasos, cada uno en su propia invocación encadenada con `after()`.
- **En vivo por HTTP**: `done` en 111 s, 3/3 tareas, 4 versiones. Se activaron todas las defensas:
  - Groq dio 429 y respondió Gemini (respaldo entre proveedores).
  - Ambos proveedores estuvieron saturados durante una revisión y decidieron los checks deterministas.
  - Un error a los 61 s se reanudó tras la pausa de 20 s.
- **Primer bucle Develop↔Testing real, por un falso positivo del revisor LLM**: dijo que «no se creó contacto.html» en la tarea de enlazar desde nosotros, cuando la página existía desde la tarea 1. El revisor solo veía los ficheros cambiados. Develop la regeneró sin necesidad.
  - Arreglo: el prompt de Testing evalúa solo la tarea actual, recibe los títulos de las otras tareas del plan y la lista de ficheros que ya existen.
  - Es un buen ejemplo de por qué los checks deterministas mandan y el LLM es una segunda opinión.

## 2026-11-23 — Fases 5 y 6: UI, login y nueva petición

- **Antes de escribir páginas**, la IA leyó la documentación incluida en Next 16, como pide `AGENTS.md`:
  - Con Cache Components, las lecturas dinámicas (`params`, BD, cookies) van dentro de `<Suspense>`.
  - `middleware.ts` ahora se llama `proxy.ts`.
- **Página de ejecución**: un componente de servidor carga la instantánea inicial y un componente de cliente se suscribe a Supabase Realtime. Cualquier cambio vuelve a pedir la instantánea, con un debounce de 250 ms. Si el canal cae, polling cada 3 s. Si la ejecución lleva más de 60 s sin eventos, la página «despierta» la cadena de pasos.
- **Verificado en el navegador** (Claude in Chrome):
  - El tablero se mueve solo durante una ejecución, con el indicador «En directo».
  - La vista previa navega entre páginas.
  - El login lleva a la portada con sesión, y el botón de demo abre la ejecución.
- **Cosas que corrigió el propio entorno**:
  - Lint marcó un `setState` dentro de un efecto. Ahora la versión seguida se deriva del estado.
  - El overlay de Next marcó `Date.now()` durante el prerender: lo llama el cliente de Supabase al crearse. Se añadió `await connection()`, la solución que indica la documentación.
- **Calidad del resultado**: el formulario que generó Develop en vivo salió sin estilos. Se añadió al prompt que estilice en `styles.css` los elementos nuevos.
- **Pendiente**: no se pudo comprobar la vista móvil, porque la ventana del navegador no cambiaba de tamaño.

## 2026-11-23 — Fase 7: despliegue

- **Revisión de secretos en el historial** antes de subir nada: ni claves (`AIza`, `gsk_`, `sb_`, JWT), ni la URL de Supabase, ni la contraseña de prueba. Solo aparecía mi gmail como autor. **Decisión mía**: reescribir la autoría con la dirección noreply de GitHub (`git filter-branch`, antes del primer push).
- Repo privado `equipo-agentes-ia` creado con `gh`.
- **Primer despliegue**:
  - El proyecto de Vercel se había creado desde la carpeta y no desde el repo, así que los push no desplegaban. Lo conecté a GitHub desde Settings → Git.
  - La URL que pasé al principio era la de un despliegue concreto, protegida con login de Vercel. La IA comprobó cuál era la de producción pública.
- **Fallo en producción**: con el navegador cerrado, las ejecuciones se paraban tras un error transitorio. Lo que pasó:
  1. La IA vio en la BD que el último paso había terminado bien y que faltaba el salto a la siguiente invocación.
  2. Primera hipótesis de la IA, **equivocada**: la protección de Vercel contra bucles (508). La verificó en la documentación (existe, pero sin umbral documentado) y aplicó un cambio que resultó útil de todos modos: varios pasos por invocación con un presupuesto blando de 60 s, así que una ejecución típica no hace ningún salto HTTP.
  3. Siguió fallando, y la IA me pidió los logs de Vercel en vez de seguir suponiendo. El único error era `Falta STEP_SECRET`: **yo había olvidado esa variable** (y `CRON_SECRET`) en Vercel.
  4. Fallo de la IA destapado por esto: la excepción escapaba del `after()` antes de registrar nada en la BD. Ahora un salto fallido siempre deja un evento de error visible, y la página reanuda la ejecución.
- **Prueba final en producción, sin navegador**: `done` en 132 s. Incluyó un 429/503 de los dos proveedores, la pausa, un salto a una invocación nueva y la integración 11/11. Esa ejecución es la destacada de la portada (`npm run set-showcase`).
- **Nombres de fichero**: el Orquestador llamó a la página `contact.html` en una web en español. Se añadió al prompt que los ficheros nuevos se nombran en español.
- Cron `/api/cron/keepalive` verificado: 200 con el secreto y 401 sin él.
