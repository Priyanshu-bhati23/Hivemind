import { calculate } from "./calc";

/**
 * The tools every agent can call. Each one is a plain function on the server:
 * the model asks for a call, the server runs it, and the result goes back to the model.
 */

const WIKI = (process.env.WIKIPEDIA_URL ?? "https://en.wikipedia.org").replace(/\/$/, "");
const HEADERS = { "User-Agent": "hivemind-demo/1.0 (portfolio project)", Accept: "application/json" };
const MAX_RESULT_CHARS = 1400;

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "search_wikipedia",
      description: "Search Wikipedia. Returns up to 3 page titles with a one-line description each.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What to search for." } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_wikipedia",
      description: "Read the summary of one Wikipedia page. Pass a title returned by search_wikipedia.",
      parameters: {
        type: "object",
        properties: { title: { type: "string", description: "Exact page title." } },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "Evaluate an arithmetic expression, for example (1200 * 0.18) / 12 or sqrt(2) * 10^3.",
      parameters: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "current_date",
      description: "Get today's date.",
      parameters: { type: "object", properties: {} },
    },
  },
];

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status}.`);
  return res.json();
}

const stripTags = (html: string) => html.replace(/<[^>]+>/g, "");

const IMPLEMENTATIONS: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
  async search_wikipedia(args) {
    const query = String(args.query ?? "").slice(0, 200);
    if (!query) return "No query was given.";
    const data = await getJson(`${WIKI}/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=3`);
    const pages = (data.pages ?? []) as Array<{ title: string; description?: string; excerpt?: string }>;
    if (!pages.length) return `No Wikipedia pages matched "${query}".`;
    return pages.map((p) => `${p.title}: ${p.description || stripTags(p.excerpt ?? "")}`).join("\n");
  },

  async read_wikipedia(args) {
    const title = String(args.title ?? "").slice(0, 200);
    if (!title) return "No title was given.";
    const data = await getJson(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    return data.extract ? `${data.title}: ${data.extract}` : `The page "${title}" has no summary.`;
  },

  async calculate(args) {
    const expression = String(args.expression ?? "");
    const value = calculate(expression);
    return `${expression} = ${Number(value.toPrecision(12))}`;
  },

  async current_date() {
    return new Date().toISOString().slice(0, 10);
  },
};

/** Run one tool call. Never throws: a failure becomes text the model can react to. */
export async function runTool(name: string, rawArgs: string): Promise<string> {
  const tool = IMPLEMENTATIONS[name];
  if (!tool) return `There is no tool called "${name}".`;
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return "The arguments were not valid JSON.";
  }
  try {
    return (await tool(args)).slice(0, MAX_RESULT_CHARS);
  } catch (err) {
    return `Tool failed: ${err instanceof Error ? err.message : "unknown error"}`;
  }
}
