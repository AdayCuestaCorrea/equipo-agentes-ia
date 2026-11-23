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
