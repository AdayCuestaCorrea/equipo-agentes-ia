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
