import type { RunEvent } from "./types";

/**
 * A scripted run, written by hand. It drives the interface through the same
 * events a live run sends, so visitors can see how it works without an API key
 * and without spending quota. It is labelled as scripted in the interface.
 */

export const SCRIPTED_GOAL = "Compare bubble sort and merge sort for sorting 1 million records, and recommend one.";

const ANSWER = `**Use merge sort.** For 1 million records it is not a close call.

- **Bubble sort** compares neighbouring items and swaps them, pass after pass. Its running time grows with the square of the input: about 10^12 basic steps for a million records.
- **Merge sort** splits the list in half, sorts each half, and merges them. Its running time grows as n log n: about 20 million steps for the same input.

That makes merge sort roughly **50,000 times less work** at this size. At a million simple steps per millisecond, that is the difference between about 20 milliseconds and well over a quarter of an hour.

Two things to know before you choose:

1. Merge sort needs extra memory, about one more copy of the list. For a million records that is usually fine.
2. Merge sort is stable, so records with equal keys keep their original order. That matters when you sort by one column after another.

In practice, do not write either by hand. Call your language's built-in sort: it is an n log n algorithm already tuned for real data.`;

/** [delay before this event in ms, event] */
export const SCRIPT: Array<[number, RunEvent]> = [
  [
    1500,
    {
      t: "plan",
      ms: 1500,
      tasks: [
        { id: "t1", agent: "researcher", title: "How each algorithm works", brief: "Find how bubble sort and merge sort work and their time complexity.", dependsOn: [] },
        { id: "t2", agent: "analyst", title: "Work for 1 million records", brief: "Calculate the number of steps each algorithm needs for n = 1,000,000 and the ratio.", dependsOn: [] },
        { id: "t3", agent: "engineer", title: "Practical recommendation", brief: "Recommend one for production use, with memory and stability trade-offs.", dependsOn: ["t1", "t2"] },
        { id: "t4", agent: "critic", title: "Check for gaps", brief: "Review the recommendation and point out anything missing.", dependsOn: ["t3"] },
      ],
    },
  ],
  [500, { t: "task_start", id: "t1" }],
  [250, { t: "task_start", id: "t2" }],
  [900, { t: "tool_call", id: "t1", call: "c1", name: "search_wikipedia", args: '{"query":"bubble sort"}' }],
  [300, { t: "tool_call", id: "t2", call: "c2", name: "calculate", args: '{"expression":"1000000^2"}' }],
  [120, { t: "tool_result", id: "t2", call: "c2", preview: "1000000^2 = 1000000000000", ms: 1 }],
  [500, { t: "tool_result", id: "t1", call: "c1", preview: "Bubble sort: Simple comparison sorting algorithm\nSorting algorithm: Algorithm that arranges lists in order\nComb sort: Interval based sorting algorithm", ms: 410 }],
  [600, { t: "tool_call", id: "t2", call: "c3", name: "calculate", args: '{"expression":"1000000 * ln(1000000) / ln(2)"}' }],
  [120, { t: "tool_result", id: "t2", call: "c3", preview: "1000000 * ln(1000000) / ln(2) = 19931568.5693", ms: 1 }],
  [500, { t: "tool_call", id: "t1", call: "c4", name: "read_wikipedia", args: '{"title":"Merge sort"}' }],
  [450, { t: "tool_call", id: "t2", call: "c5", name: "calculate", args: '{"expression":"1000000^2 / 19931568.5693"}' }],
  [120, { t: "tool_result", id: "t2", call: "c5", preview: "1000000^2 / 19931568.5693 = 50171.6659", ms: 1 }],
  [400, { t: "tool_result", id: "t1", call: "c4", preview: "Merge sort: an efficient, general-purpose, comparison-based sorting algorithm. Most implementations are stable. It is a divide-and-conquer algorithm.", ms: 380 }],
  [
    900,
    {
      t: "task_done",
      id: "t2",
      ms: 3100,
      output:
        "For n = 1,000,000: bubble sort is on the order of n^2 = 10^12 steps. Merge sort is on the order of n log2 n = about 19.9 million steps. The ratio is about 50,172, so merge sort does roughly 50,000 times less work at this size.",
    },
  ],
  [
    700,
    {
      t: "task_done",
      id: "t1",
      ms: 4300,
      output:
        "Bubble sort repeatedly steps through the list, compares neighbouring items and swaps them when they are out of order. Its average and worst-case time is O(n^2). Merge sort divides the list in half, sorts each half and merges the results. Its time is O(n log n) in every case, and most implementations are stable. Sources: the Bubble sort and Merge sort pages.",
    },
  ],
  [400, { t: "task_start", id: "t3" }],
  [1300, { t: "tool_call", id: "t3", call: "c6", name: "calculate", args: '{"expression":"19931568 / 1000000"}' }],
  [120, { t: "tool_result", id: "t3", call: "c6", preview: "19931568 / 1000000 = 19.931568", ms: 1 }],
  [
    1500,
    {
      t: "task_done",
      id: "t3",
      ms: 2900,
      output:
        "Recommend merge sort. At a million simple steps per millisecond it finishes in about 20 ms, where bubble sort would need over 16 minutes. Trade-off: merge sort needs O(n) extra memory for the merge buffer. It is stable, which helps multi-column sorts.",
    },
  ],
  [400, { t: "task_start", id: "t4" }],
  [
    2000,
    {
      t: "task_done",
      id: "t4",
      ms: 2000,
      output:
        "The recommendation holds. Missing: in real code you should call the language's built-in sort, which is already an n log n algorithm tuned for real data, instead of writing merge sort by hand. The timing figure assumes simple steps and ignores memory effects, so treat it as an order of magnitude.",
    },
  ],
  [500, { t: "synth_start" }],
  ...ANSWER.split(/(?<= )/).map((word): [number, RunEvent] => [26, { t: "final_delta", text: word }]),
  [300, { t: "done", ms: 15200, tokens: 6840 }],
];
