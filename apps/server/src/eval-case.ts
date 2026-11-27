/**
 * A draft eval case from a finished run (todo item 49): the run's task, the notes it read as seed notes, and what it did as
 * the first guess of what is expected. The owner checks and edits the draft before using it; it is never run by itself.
 */
import { slugify } from "@vigil/shared";
import type { CaseFile } from "./evals/case-file";
import { redact } from "./llm";
import { approvalsForRun, getAgent, getRun, listEvents } from "./state-db";
import { getNote } from "./vault";

/** The task the run was given: the part of the prompt event after the last "Task: ". */
function taskOf(promptText: string): string {
  const at = promptText.lastIndexOf("\n\nTask: ");
  return at < 0 ? "" : promptText.slice(at + "\n\nTask: ".length).trim();
}

/** Note ids from the run's `read_note` calls, in order, once each. */
function readIds(events: { kind: string; text: string; data: Record<string, unknown> }[]): string[] {
  const ids: string[] = [];
  for (const e of events) {
    if (e.kind !== "tool-call" || e.data["tool"] !== "read_note") continue;
    const args = e.text.slice("read_note(".length, -1);
    try {
      const id = (JSON.parse(args) as { id?: unknown }).id;
      if (typeof id === "string" && !ids.includes(id)) ids.push(id);
    } catch {
      continue; // the logged arguments were cut at 300 characters: that read is left out of the seed
    }
  }
  return ids;
}

export async function evalCaseFor(runId: string): Promise<CaseFile | null> {
  const run = getRun(runId);
  if (!run) return null;
  const events = listEvents(runId);
  const agent = getAgent(run.agent);
  const task = taskOf(events.find((e) => e.kind === "prompt")?.text ?? "") || agent?.defaultTask || "";
  const seed: { title: string; body: string }[] = [];
  for (const id of readIds(events)) {
    try {
      const note = await getNote(id);
      seed.push({ title: note.title, body: redact(note.body) });
    } catch {
      continue; // the note is gone since the run: the case is still useful without it
    }
  }
  const called = [...new Set(events.flatMap((e) => (e.kind === "tool-call" && typeof e.data["tool"] === "string" ? [e.data["tool"]] : [])))];
  const wrote = run.touched.length > 0 || approvalsForRun(runId).length > 0;
  return {
    id: slugify(`${run.agent}-${run.id.slice(0, 8)}`),
    suite: "regression",
    should: wrote ? "act" : "refrain",
    task: redact(task),
    agent: { tools: agent?.tools ?? ["read_notes"], strict: agent?.strict ?? true },
    ...(seed.length > 0 ? { seed } : {}),
    expect: {
      status: [run.status],
      ...(called.length > 0 ? { calls: called } : {}),
      ...(wrote ? { exists: run.touched } : { noWrites: true }),
    },
  };
}
