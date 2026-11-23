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
