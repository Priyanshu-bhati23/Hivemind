import type { AgentId, RunEvent, Task } from "./types";

export interface ToolUse {
  call: string;
  name: string;
  args: string;
  preview?: string;
  ms?: number;
}

export interface TaskState extends Task {
  status: "queued" | "working" | "done" | "failed";
  tools: ToolUse[];
  output?: string;
  ms?: number;
  error?: string;
}

/** A one-off animation cue for the 3D scene. */
export interface Signal {
  key: number;
  kind: "send" | "return" | "tool" | "answer";
  agent?: AgentId;
}

export interface RunState {
  phase: "idle" | "planning" | "working" | "writing" | "done" | "error";
  goal: string;
  scripted: boolean;
  tasks: TaskState[];
  final: string;
  error?: string;
  waiting?: number;
  ms?: number;
  tokens?: number;
  signals: Signal[];
}

export const IDLE: RunState = { phase: "idle", goal: "", scripted: false, tasks: [], final: "", signals: [] };

export type Action = { type: "start"; goal: string; scripted: boolean } | { type: "event"; event: RunEvent } | { type: "reset" };

let signalKey = 0;

export function reduce(state: RunState, action: Action): RunState {
  if (action.type === "reset") return IDLE;
  if (action.type === "start") return { ...IDLE, phase: "planning", goal: action.goal, scripted: action.scripted };

  const event = action.event;
  const signal = (kind: Signal["kind"], agent?: AgentId): Signal[] => [...state.signals.slice(-40), { key: ++signalKey, kind, agent }];
  const patchTask = (id: string, change: (task: TaskState) => TaskState) => state.tasks.map((t) => (t.id === id ? change(t) : t));
  const agentOf = (id: string) => state.tasks.find((t) => t.id === id)?.agent;

  switch (event.t) {
    case "plan":
      return { ...state, phase: "working", waiting: undefined, tasks: event.tasks.map((t) => ({ ...t, status: "queued", tools: [] })) };
    case "task_start":
      return { ...state, waiting: undefined, tasks: patchTask(event.id, (t) => ({ ...t, status: "working" })), signals: signal("send", agentOf(event.id)) };
    case "tool_call":
      return {
        ...state,
        tasks: patchTask(event.id, (t) => ({ ...t, tools: [...t.tools, { call: event.call, name: event.name, args: event.args }] })),
        signals: signal("tool", agentOf(event.id)),
      };
    case "tool_result":
      return {
        ...state,
        tasks: patchTask(event.id, (t) => ({
          ...t,
          tools: t.tools.map((use) => (use.call === event.call ? { ...use, preview: event.preview, ms: event.ms } : use)),
        })),
      };
    case "task_done":
      return {
        ...state,
        waiting: undefined,
        tasks: patchTask(event.id, (t) => ({ ...t, status: "done", output: event.output, ms: event.ms })),
        signals: signal("return", agentOf(event.id)),
      };
    case "task_error":
      return { ...state, tasks: patchTask(event.id, (t) => ({ ...t, status: "failed", error: event.message })) };
    case "synth_start":
      return { ...state, phase: "writing", waiting: undefined, signals: signal("answer") };
    case "final_delta":
      return { ...state, waiting: undefined, final: state.final + event.text };
    case "wait":
      return { ...state, waiting: event.seconds };
    case "done":
      return { ...state, phase: "done", waiting: undefined, ms: event.ms, tokens: event.tokens };
    case "error":
      return { ...state, phase: "error", waiting: undefined, error: event.message };
  }
}
