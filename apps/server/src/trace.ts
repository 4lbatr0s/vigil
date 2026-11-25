import type { Run, RunEvent } from "@vigil/shared";
import { redact } from "./llm";
import { getRun, listChildRuns, listEvents } from "./state-db";

/** One run as a line: `type: "run"`, the run's fields, and the config version from its prompt event (item 23). */
function runLine(run: Run, events: RunEvent[]): Record<string, unknown> {
  const prompt = events.find((e) => e.kind === "prompt");
  const config = prompt?.data["config"];
  return { type: "run", runId: run.id, ...withoutId(run), config: typeof config === "string" ? config : null };
}

function withoutId(run: Run): Omit<Run, "id"> {
  const { id: _id, ...rest } = run;
  return rest;
}

const eventLine = (runId: string, e: RunEvent): Record<string, unknown> => ({ type: "event", runId, ...e });

/**
 * A run and its child runs as JSON Lines, for reading in a script or another tool: the run, its events in order, then each
 * child run and its events. Null when the run does not exist. Events are stored redacted; each line is redacted again so a
 * key that slipped in never leaves the server.
 */
export function runTrace(runId: string): string | null {
  const run = getRun(runId);
  if (!run) return null;
  const out: string[] = [];
  const add = (r: Run): void => {
    const events = listEvents(r.id);
    out.push(JSON.stringify(runLine(r, events)));
    for (const e of events) out.push(JSON.stringify(eventLine(r.id, e)));
  };
  add(run);
  for (const child of listChildRuns(run.id)) add(child);
  return out.map((l) => redact(l)).join("\n") + "\n";
}
