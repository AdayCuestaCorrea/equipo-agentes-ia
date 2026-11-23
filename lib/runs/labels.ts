import type { Agent, RunStatus, TaskStatus } from "@/lib/domain/types";
import type { AgentUiState, RunSnapshot } from "./snapshot";

export const AGENT_LABEL: Record<Agent, string> = {
  orchestrator: "Orquestador",
  develop: "Develop",
  testing: "Testing",
};

export const AGENT_ROLE: Record<Agent, string> = {
  orchestrator: "Divide la petición en tareas y las reparte",
  develop: "Implementa cada tarea en la web",
  testing: "Comprueba cada entrega y devuelve lo que falla",
};

export const AGENT_STATE_LABEL: Record<AgentUiState, string> = {
  idle: "Inactivo",
  working: "Trabajando",
  waiting: "Esperando",
  done: "Terminado",
  error: "Detenido",
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "En cola",
  planning: "Planificando",
  running: "En curso",
  integrating: "Verificación final",
  done: "Completada",
  done_with_failures: "Completada con fallos",
  failed: "Fallida",
};

export const TASK_COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "pending", label: "Pendiente" },
  { status: "developing", label: "En desarrollo" },
  { status: "testing", label: "En pruebas" },
  { status: "fixing", label: "Corrigiendo" },
  { status: "passed", label: "Superada" },
  { status: "failed", label: "Fallida" },
];

export const MESSAGE_KIND_LABEL: Record<RunSnapshot["messages"][number]["kind"], string> = {
  assignment: "Asignación",
  delivery: "Entrega",
  test_report: "Informe de pruebas",
  feedback: "Fallos a corregir",
  summary: "Resumen final",
};
