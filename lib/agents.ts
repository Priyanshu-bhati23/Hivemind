import type { AgentId } from "./types";

export interface Agent {
  id: AgentId;
  name: string;
  color: string;
  does: string;
  prompt: string;
}

export const AGENTS: Agent[] = [
  {
    id: "researcher",
    name: "Researcher",
    color: "#2F6BFF",
    does: "Looks things up on Wikipedia",
    prompt:
      "You are the Researcher. Find facts with the Wikipedia tools before you answer. Search first, then read the best page. Report only what the pages say, and name the page each fact came from.",
  },
  {
    id: "analyst",
    name: "Analyst",
    color: "#8B45FF",
    does: "Runs the numbers",
    prompt:
      "You are the Analyst. Work with numbers and comparisons. Use the calculate tool for every calculation instead of doing arithmetic in your head, and show the figures you used.",
  },
  {
    id: "engineer",
    name: "Engineer",
    color: "#0E9F6E",
    does: "Designs the technical approach",
    prompt:
      "You are the Engineer. Propose a concrete technical approach: components, data flow, and the main trade-off. Use the calculate tool for any sizing or cost estimate. Short code is welcome when it helps.",
  },
  {
    id: "writer",
    name: "Writer",
    color: "#F0457A",
    does: "Turns findings into clear prose",
    prompt:
      "You are the Writer. Turn the material you are given into clear, well organised prose for a general reader. Do not add facts that are not in the material.",
  },
  {
    id: "critic",
    name: "Critic",
    color: "#F26A1B",
    does: "Checks the work for gaps",
    prompt:
      "You are the Critic. Review the material you are given. List the weakest claims, anything missing, and one concrete improvement. Be specific and brief.",
  },
];

export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a])) as Record<AgentId, Agent>;

export const ORCHESTRATOR_COLOR = "#FFB400";
