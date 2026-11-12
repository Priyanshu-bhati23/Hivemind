"use client";

import dynamic from "next/dynamic";
import { useEffect, useReducer, useRef, useState } from "react";
import { AGENT_BY_ID } from "@/lib/agents";
import { IDLE, reduce, type RunState, type TaskState } from "@/lib/run-state";
import { SCRIPT, SCRIPTED_GOAL } from "@/lib/scripted";
import { errorOf, readNdjson } from "@/lib/stream";
import type { RunEvent } from "@/lib/types";
import { Markdown } from "./Markdown";

const Hive = dynamic(() => import("./Hive"), { ssr: false });

const EXAMPLES = [
  "Who invented the transistor, and why did it replace the vacuum tube?",
  "Estimate the yearly cost of serving 2,000 requests a second on servers that each handle 400.",
  "Explain how mRNA vaccines work and what limits how fast they can be made.",
];

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function headline(state: RunState): string {
  const done = state.tasks.filter((t) => t.status === "done" || t.status === "failed").length;
  switch (state.phase) {
    case "planning":
      return "Planning the work";
    case "working":
      return `${done} of ${state.tasks.length} tasks done`;
    case "writing":
      return "Writing the answer";
    case "done":
      return state.ms ? `Done in ${seconds(state.ms)}` : "Done";
    case "error":
      return "The run stopped";
    default:
      return "";
  }
}

export default function Console() {
  const reducedMotion = useReducedMotion();
  const [state, dispatch] = useReducer(reduce, IDLE);
  const [goal, setGoal] = useState("");
  const stop = useRef<() => void>(() => {});
  const logEnd = useRef<HTMLDivElement>(null);

  const busy = state.phase === "planning" || state.phase === "working" || state.phase === "writing";

  useEffect(() => () => stop.current(), []);

  useEffect(() => {
    if (state.phase === "writing" || state.phase === "done") logEnd.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [state.phase, state.final, reducedMotion]);

  const fail = (message: string) => dispatch({ type: "event", event: { t: "error", message } });

  const run = async (text: string) => {
    const value = text.trim();
    if (!value || busy) return;
    stop.current();
    const controller = new AbortController();
    stop.current = () => controller.abort();
    dispatch({ type: "start", goal: value, scripted: false });
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: value }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const { message, code } = await errorOf(res);
        return fail(
          code === "no_key"
            ? "Live runs are switched off because the server has no Groq key. Add GROQ_API_KEY to the project's environment variables and redeploy. The scripted demo works without it."
            : message,
        );
      }
      let finished = false;
      await readNdjson<RunEvent>(res, (event) => {
        if (event.t === "done" || event.t === "error") finished = true;
        dispatch({ type: "event", event });
      });
      if (!finished) fail("The connection closed before the run finished. Try again.");
    } catch {
      if (!controller.signal.aborted) fail("The server could not be reached. Check your connection and try again.");
    }
  };

  const playScript = () => {
    stop.current();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    stop.current = () => {
      cancelled = true;
      clearTimeout(timer);
    };
    setGoal(SCRIPTED_GOAL);
    dispatch({ type: "start", goal: SCRIPTED_GOAL, scripted: true });
    let index = 0;
    const next = () => {
      if (cancelled || index >= SCRIPT.length) return;
      const [delay, event] = SCRIPT[index++];
      timer = setTimeout(() => {
        dispatch({ type: "event", event });
        next();
      }, delay);
    };
    next();
  };

  const cancel = () => {
    stop.current();
    dispatch({ type: "reset" });
  };

  const toolCalls = state.tasks.reduce((sum, t) => sum + t.tools.length, 0);

  return (
    <div className="shell">
      <section className="stage" aria-label="Agent hive">
        <div className="hive">
          <Hive state={state} reducedMotion={reducedMotion} />
        </div>
        <header className="masthead">
          <span className="brand">
            <i aria-hidden />
            Hivemind
          </span>
          {state.phase === "idle" ? (
            <>
              <h1>One goal. A team of agents working on it.</h1>
              <p>
                An orchestrator splits your goal into tasks. Specialist agents run them in parallel, calling real tools, and hand their results back. Every
                step shows up here as it happens.
              </p>
            </>
          ) : (
            <div className="status" role="status">
              <h2>{headline(state)}</h2>
              <p>{state.goal}</p>
              {state.scripted && <span className="tag">Scripted demo, not live AI output</span>}
            </div>
          )}
        </header>
      </section>

      <aside className="desk">
        <form
          className="goal"
          onSubmit={(e) => {
            e.preventDefault();
            run(goal);
          }}
        >
          <label htmlFor="goal">Your goal</label>
          <textarea
            id="goal"
            rows={3}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(goal);
            }}
            placeholder="A question or a job that takes a few steps to answer"
            maxLength={500}
            disabled={busy}
          />
          <div className="goal-actions">
            {busy ? (
              <button type="button" className="btn btn-quiet" onClick={cancel}>
                Stop
              </button>
            ) : (
              <button className="btn" disabled={!goal.trim()}>
                Run the team
              </button>
            )}
            <button type="button" className="link" onClick={playScript} disabled={busy}>
              Watch a scripted demo
            </button>
          </div>
        </form>

        {state.phase === "idle" ? (
          <div className="examples">
            <h3>Goals to try</h3>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                onClick={() => {
                  setGoal(example);
                  run(example);
                }}
              >
                {example}
              </button>
            ))}
            <h3>The team</h3>
            <ul className="roster">
              {Object.values(AGENT_BY_ID).map((agent) => (
                <li key={agent.id}>
                  <i className="hex" style={{ background: agent.color }} />
                  <b>{agent.name}</b>
                  {agent.does}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="log">
            {state.phase === "planning" && <p className="log-line working">The orchestrator is splitting the goal into tasks</p>}
            {state.tasks.length > 0 && (
              <p className="log-line">
                Plan: {state.tasks.length} tasks
                {state.tasks.some((t) => t.dependsOn.length === 0) && `, ${state.tasks.filter((t) => t.dependsOn.length === 0).length} start in parallel`}
              </p>
            )}
            <ol className="tasks">
              {state.tasks.map((task) => (
                <TaskRow key={task.id} task={task} all={state.tasks} />
              ))}
            </ol>

            {state.waiting && (
              <p className="notice">Groq&apos;s rate limit was reached. Waiting {state.waiting} seconds, then the run continues.</p>
            )}

            {(state.phase === "writing" || state.final) && (
              <section className="answer">
                <h3>Answer</h3>
                {state.final ? (
                  <div className={state.phase === "writing" ? "cursor" : ""}>
                    <Markdown text={state.final} />
                  </div>
                ) : (
                  <p className="log-line working">Combining the results</p>
                )}
              </section>
            )}

            {state.phase === "error" && (
              <p className="notice notice-error" role="alert">
                {state.error}
              </p>
            )}

            {state.phase === "done" && (
              <dl className="stats">
                <div>
                  <dt>Time</dt>
                  <dd>{state.ms ? seconds(state.ms) : "n/a"}</dd>
                </div>
                <div>
                  <dt>Agents</dt>
                  <dd>{new Set(state.tasks.map((t) => t.agent)).size}</dd>
                </div>
                <div>
                  <dt>Tool calls</dt>
                  <dd>{toolCalls}</dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd>{state.tokens?.toLocaleString() ?? "n/a"}</dd>
                </div>
              </dl>
            )}
            {(state.phase === "done" || state.phase === "error") && (
              <button className="link" onClick={cancel}>
                Start a new run
              </button>
            )}
            <div ref={logEnd} />
          </div>
        )}
      </aside>
    </div>
  );
}

function formatArgs(raw: string): string {
  try {
    const args = JSON.parse(raw) as Record<string, unknown>;
    return Object.values(args)
      .map((v) => (typeof v === "string" ? `"${v}"` : JSON.stringify(v)))
      .join(", ");
  } catch {
    return raw;
  }
}

function TaskRow({ task, all }: { task: TaskState; all: TaskState[] }) {
  const agent = AGENT_BY_ID[task.agent];
  const after = task.dependsOn.map((id) => all.find((t) => t.id === id)?.title).filter(Boolean);
  const status = { queued: after.length ? "Waiting" : "Queued", working: "Working", done: task.ms ? seconds(task.ms) : "Done", failed: "Failed" }[task.status];

  return (
    <li className={`task task-${task.status}`} style={{ "--agent": agent.color } as React.CSSProperties}>
      <i className="hex" />
      <div className="task-head">
        <b>{agent.name}</b>
        <span>{task.title}</span>
        <em>{status}</em>
      </div>
      {task.status === "queued" && after.length > 0 && <p className="task-note">Needs: {after.join(", ")}</p>}
      {task.tools.map((use) => (
        <div key={use.call} className="tool">
          <code>
            {use.name}({formatArgs(use.args)})
          </code>
          {use.preview !== undefined ? <p>{use.preview}</p> : <p className="working">Running</p>}
        </div>
      ))}
      {task.error && <p className="task-note task-error">{task.error}</p>}
      {task.output && (
        <details>
          <summary>What the {agent.name.toLowerCase()} reported</summary>
          <Markdown text={task.output} />
        </details>
      )}
    </li>
  );
}
