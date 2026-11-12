export type AgentId =
  | "researcher"
  | "analyst"
  | "engineer"
  | "writer"
  | "critic"
  | "strategist"
  | "designer"
  | "factchecker"
  | "explainer"
  | "risk"
  | "product";

export interface Task {
  id: string;
  agent: AgentId;
  title: string;
  brief: string;
  dependsOn: string[];
}

/** Everything the server tells the browser during a run, in order. */
export type RunEvent =
  | { t: "plan"; tasks: Task[]; ms: number }
  | { t: "task_start"; id: string }
  | { t: "tool_call"; id: string; call: string; name: string; args: string }
  | { t: "tool_result"; id: string; call: string; preview: string; ms: number }
  | { t: "task_done"; id: string; output: string; ms: number }
  | { t: "task_error"; id: string; message: string }
  | { t: "synth_start" }
  | { t: "final_delta"; text: string }
  | { t: "wait"; seconds: number }
  | { t: "done"; ms: number; tokens: number }
  | { t: "error"; message: string; code?: string };
