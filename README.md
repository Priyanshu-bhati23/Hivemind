# Hivemind

Give one goal to a team of AI agents and watch them work. An orchestrator plans the tasks, specialist agents run them in parallel with real tool calls, and every step is drawn live on a 3D honeycomb.

## What it does

1. **Plan**: the orchestrator splits your goal into 3 to 5 tasks, assigns each to an agent, and declares which tasks depend on which.
2. **Run**: tasks run as a dependency graph. Independent tasks run in parallel. Each agent can call tools, read the results, and call more.
3. **Answer**: the orchestrator combines the agents' reports into one streamed answer.

The 3D hive and the log are two views of the same event stream: cells rise while their agent works, packets fly on every hand-off, and each tool call ripples from the agent's cell.

**Scripted demo**: "Watch a scripted demo" plays a hand-written run through the same interface. It needs no API key and is labelled as scripted.

## The agents and their tools

| Agent | Job |
| --- | --- |
| Researcher | Looks things up on Wikipedia |
| Analyst | Runs the numbers |
| Engineer | Designs the technical approach |
| Writer | Turns findings into clear prose |
| Critic | Checks the work for gaps |

| Tool | What it does |
| --- | --- |
| `search_wikipedia` | Searches Wikipedia's public API |
| `read_wikipedia` | Reads one page's summary |
| `calculate` | Evaluates arithmetic with a hand-written parser. Nothing from the model is ever run as code. |
| `current_date` | Returns today's date |

## How it is built

| Part | Where | Notes |
| --- | --- | --- |
| Orchestration | `app/api/run/route.ts` | Structured-output planning, a small task-graph scheduler, a tool loop per agent, streamed synthesis. |
| Tools | `lib/tools.ts`, `lib/calc.ts` | Plain server functions. Failures are returned to the model as text so it can recover. |
| Event protocol | `lib/types.ts`, `lib/stream.ts` | Newline-delimited JSON over one streaming response. |
| Client state | `lib/run-state.ts` | One reducer turns events into state for both the log and the 3D scene. |
| 3D scene | `components/Hive.tsx` | React Three Fiber, orthographic camera, soft shadows. |

Stack: Next.js (App Router), TypeScript, React Three Fiber, three.js, Groq (`openai/gpt-oss-120b` plans and writes, `openai/gpt-oss-20b` runs the agents).

## Run it locally

```bash
npm install
cp .env.example .env.local   # then add your GROQ_API_KEY
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel

1. Import the repository in Vercel.
2. Add the environment variable `GROQ_API_KEY`.
3. Deploy.

## Limits

- A run makes several model calls. On Groq's free plan a per-minute token limit can be hit mid-run. The server waits and retries when the wait is short, and tells you when it does.
- Each visitor is limited to 4 runs a minute.
- The planner's output is validated before anything runs: unknown agents are dropped and dependencies may only point to earlier tasks.
