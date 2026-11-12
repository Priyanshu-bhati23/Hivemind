import { AGENT_BY_ID, AGENTS } from "@/lib/agents";
import { MODELS, chat, chatStream, hasKey, parseJson, GroqError, type Message } from "@/lib/groq";
import { clientId, overLimit, tooMany } from "@/lib/ratelimit";
import { ndjson } from "@/lib/stream";
import { TOOL_SCHEMAS, runTool } from "@/lib/tools";
import type { AgentId, RunEvent, Task } from "@/lib/types";

export const maxDuration = 60;

const MAX_TASKS = 5;
const MAX_TOOL_ROUNDS = 3;
const PARALLEL = 3;

const PLAN_SYSTEM = `You are the orchestrator of a team of AI agents. Split the user's goal into 3 to ${MAX_TASKS} tasks.

The agents:
${AGENTS.map((a) => `- ${a.id}: ${a.does}.`).join("\n")}

Rules:
- Each task goes to exactly one agent and must be doable in a few sentences of output.
- Give tasks ids "t1", "t2", and so on.
- "dependsOn" lists the ids of earlier tasks whose output this task needs. Tasks with no dependencies run in parallel, so only add a dependency when the task really needs that output.
- Use the researcher for facts, the analyst for numbers, and finish with a writer or critic task that depends on the others when that helps.
- "title" is at most 6 words. "brief" is one or two sentences telling the agent exactly what to produce.

Reply with JSON: {"tasks": [{"id": "t1", "agent": "researcher", "title": "...", "brief": "...", "dependsOn": []}]}`;

const PLAN_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "plan",
    schema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              agent: { type: "string", enum: AGENTS.map((a) => a.id) },
              title: { type: "string" },
              brief: { type: "string" },
              dependsOn: { type: "array", items: { type: "string" } },
            },
            required: ["id", "agent", "title", "brief", "dependsOn"],
            additionalProperties: false,
          },
        },
      },
      required: ["tasks"],
      additionalProperties: false,
    },
  },
};

const SYNTH_SYSTEM = `You are the orchestrator. Your agents have finished their tasks. Write the final answer to the user's goal from their outputs.
Markdown, under 260 words. Lead with the answer. Keep the specific facts and figures the agents found. If the critic raised a real problem, fix it or say so. Do not describe the process or mention the agents.`;

/** Make whatever the planner returned safe to execute. */
function cleanPlan(raw: unknown): Task[] {
  const list = Array.isArray((raw as { tasks?: unknown })?.tasks) ? ((raw as { tasks: unknown[] }).tasks as Record<string, unknown>[]) : [];
  const tasks: Task[] = [];
  for (const item of list.slice(0, MAX_TASKS)) {
    const agent = String(item.agent ?? "") as AgentId;
    if (!AGENT_BY_ID[agent] || !item.brief) continue;
    tasks.push({
      id: `t${tasks.length + 1}`,
      agent,
      title: String(item.title ?? AGENT_BY_ID[agent].name).slice(0, 60),
      brief: String(item.brief).slice(0, 400),
      // Dependencies may only point backwards, which also rules out cycles.
      dependsOn: (Array.isArray(item.dependsOn) ? item.dependsOn : [])
        .map((d) => String(d))
        .map((d) => {
          const index = list.findIndex((other) => String(other.id) === d);
          return index >= 0 && index < tasks.length ? `t${index + 1}` : "";
        })
        .filter(Boolean),
    });
  }
  return tasks;
}

/**
 * POST /api/run {goal}
 * Plans, runs the tasks as a dependency graph with tool calls, then writes the
 * final answer. Every step is streamed to the browser as it happens.
 */
export async function POST(req: Request) {
  const wait = overLimit(`run:${clientId(req)}`, 4, 60);
  if (wait) return tooMany(wait);

  let goal = "";
  try {
    goal = String((await req.json()).goal ?? "").trim().slice(0, 500);
  } catch {
    // Handled below as an empty goal.
  }
  if (!goal) return Response.json({ error: "Enter a goal first.", code: "empty" }, { status: 400 });
  if (!hasKey()) return Response.json({ error: "GROQ_API_KEY is not set on the server.", code: "no_key" }, { status: 503 });

  return ndjson<RunEvent>(async (send) => {
    const started = Date.now();
    let tokens = 0;
    const onWait = (seconds: number) => send({ t: "wait", seconds });

    try {
      // 1. Plan
      const planned = await chat(
        {
          model: MODELS.smart,
          temperature: 0.2,
          max_completion_tokens: 900,
          reasoning_effort: "low",
          include_reasoning: false,
          response_format: PLAN_SCHEMA,
          messages: [
            { role: "system", content: PLAN_SYSTEM },
            { role: "user", content: goal },
          ],
        },
        { signal: req.signal, onWait },
      );
      tokens += planned.usage.total_tokens;
      const tasks = cleanPlan(parseJson(planned.message.content));
      if (tasks.length < 2) throw new GroqError("The planner did not return a usable plan. Try rephrasing the goal.", 502, "upstream");
      send({ t: "plan", tasks, ms: Date.now() - started });

      // 2. Run the task graph
      const outputs = new Map<string, string>();
      const failed = new Set<string>();

      const runTask = async (task: Task) => {
        const taskStart = Date.now();
        send({ t: "task_start", id: task.id });
        try {
          const inputs = task.dependsOn
            .filter((id) => outputs.has(id))
            .map((id) => `Output of "${tasks.find((t) => t.id === id)?.title}":\n${outputs.get(id)}`)
            .join("\n\n");

          const messages: Message[] = [
            {
              role: "system",
              content: `${AGENT_BY_ID[task.agent].prompt}\nAnswer in under 130 words. Plain text or short Markdown. No preamble.`,
            },
            { role: "user", content: `Overall goal: ${goal}\n\nYour task: ${task.brief}${inputs ? `\n\n${inputs}` : ""}` },
          ];

          for (let round = 0; ; round++) {
            const lastRound = round >= MAX_TOOL_ROUNDS;
            const reply = await chat(
              {
                model: MODELS.fast,
                temperature: 0.3,
                max_completion_tokens: 600,
                reasoning_effort: "low",
                include_reasoning: false,
                messages,
                tools: TOOL_SCHEMAS,
                tool_choice: lastRound ? "none" : "auto",
              },
              { signal: req.signal, onWait },
            );
            tokens += reply.usage.total_tokens;

            const calls = reply.message.tool_calls ?? [];
            if (!calls.length || lastRound) {
              const output = (reply.message.content ?? "").trim() || "(no output)";
              outputs.set(task.id, output);
              send({ t: "task_done", id: task.id, output, ms: Date.now() - taskStart });
              return;
            }

            messages.push({ role: "assistant", content: reply.message.content ?? "", tool_calls: calls });
            const results = await Promise.all(
              calls.slice(0, 3).map(async (call) => {
                const callStart = Date.now();
                send({ t: "tool_call", id: task.id, call: call.id, name: call.function.name, args: call.function.arguments });
                const result = await runTool(call.function.name, call.function.arguments);
                send({ t: "tool_result", id: task.id, call: call.id, preview: result.slice(0, 280), ms: Date.now() - callStart });
                return { call, result };
              }),
            );
            for (const { call, result } of results) {
              messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: result });
            }
          }
        } catch (err) {
          failed.add(task.id);
          send({ t: "task_error", id: task.id, message: err instanceof Error ? err.message : "This task failed." });
        }
      };

      const pending = new Set(tasks.map((t) => t.id));
      const running = new Map<string, Promise<void>>();
      while (pending.size || running.size) {
        for (const task of tasks) {
          if (running.size >= PARALLEL) break;
          if (!pending.has(task.id)) continue;
          const ready = task.dependsOn.every((id) => outputs.has(id) || failed.has(id));
          if (!ready) continue;
          pending.delete(task.id);
          running.set(
            task.id,
            runTask(task).finally(() => running.delete(task.id)),
          );
        }
        if (!running.size) break;
        await Promise.race(running.values());
      }

      if (!outputs.size) throw new GroqError("Every task failed, so there is nothing to summarise.", 502, "upstream");

      // 3. Write the final answer
      send({ t: "synth_start" });
      const parts = chatStream(
        {
          model: MODELS.smart,
          temperature: 0.4,
          max_completion_tokens: 900,
          reasoning_effort: "low",
          include_reasoning: false,
          messages: [
            { role: "system", content: SYNTH_SYSTEM },
            {
              role: "user",
              content: `Goal: ${goal}\n\n${tasks
                .filter((t) => outputs.has(t.id))
                .map((t) => `## ${AGENT_BY_ID[t.agent].name}: ${t.title}\n${outputs.get(t.id)}`)
                .join("\n\n")}`,
            },
          ],
        },
        { signal: req.signal, onWait },
      );
      for await (const part of parts) {
        if (part.type === "text") send({ t: "final_delta", text: part.text });
        else tokens += part.usage.total_tokens;
      }
      send({ t: "done", ms: Date.now() - started, tokens });
    } catch (err) {
      if (req.signal.aborted) return;
      send({
        t: "error",
        message: err instanceof Error ? err.message : "The run failed.",
        code: err instanceof GroqError ? err.code : "server",
      });
    }
  });
}
