import type { Run, RunEvent } from "@vigil/shared";

export const KIND_LABEL: Record<RunEvent["kind"], string> = {
  prompt: "PROMPT",
  model: "MODEL",
  "tool-call": "CALL",
  "tool-result": "RESULT",
  "tool-denied": "DENIED",
  note: "NOTE",
  stop: "STOP",
};

/** Appends events we have not seen (by sequence number), keeping order. */
export function mergeEvents(existing: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const last = existing.at(-1)?.seq ?? 0;
  const fresh = incoming.filter((e) => e.seq > last);
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}

export function lastSeq(events: RunEvent[]): number {
  return events.at(-1)?.seq ?? 0;
}

/** Undo needs something to undo, a finished run, and no earlier undo. */
export function canUndo(run: Pick<Run, "touched" | "status" | "undone">): boolean {
  return run.touched.length > 0 && run.status !== "running" && !run.undone;
}

/** The note a `note` event is about, if the server recorded one. */
export function noteIdOf(event: RunEvent): string | null {
  const id = event.data["id"];
  return event.kind === "note" && typeof id === "string" ? id : null;
}

/** Note ids named after the colon in an `undo-conflict` style message ("...: a, b"). */
export function noteIdsInMessage(message: string): string[] {
  const colon = message.lastIndexOf(": ");
  if (colon < 0) return [];
  return message
    .slice(colon + 2)
    .split(",")
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter((s) => /^[a-z0-9][a-z0-9-]*$/.test(s));
}

/** Share of the token budget used, 0 to 1. */
export function budgetShare(run: Pick<Run, "tokensUsed" | "tokenBudget">): number {
  return run.tokenBudget > 0 ? Math.min(1, run.tokensUsed / run.tokenBudget) : 0;
}

/** First line of a long log text, for the collapsed view. */
export function preview(text: string, max = 160): { short: string; long: boolean } {
  const firstLine = text.split("\n", 1)[0] ?? "";
  const long = text.length > max || text.includes("\n");
  return { short: firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine, long };
}

/** The child run a `call_agent` result event points at, if any. */
export function childRunIdOf(event: RunEvent): string | null {
  const id = event.data["childRunId"];
  return event.kind === "tool-result" && typeof id === "string" ? id : null;
}

/** "1,204 tokens · 2.1 s" for a model step, "0.4 s" for a tool step; empty when the log has no numbers for it. */
export function stepStats(event: Pick<RunEvent, "kind" | "data">): string {
  const ms = event.data["ms"];
  const tokens = event.data["tokens"];
  const parts: string[] = [];
  if (event.kind === "model" && typeof tokens === "number") parts.push(`${tokens.toLocaleString("en-US")} tokens`);
  if ((event.kind === "model" || event.kind === "tool-result") && typeof ms === "number") parts.push(ms < 100 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
  return parts.join(" · ");
}

/** The config version the run's agent had, from the prompt event (eight characters), or null for an older run. */
export function configOf(events: Pick<RunEvent, "kind" | "data">[]): string | null {
  const v = events.find((e) => e.kind === "prompt")?.data["config"];
  return typeof v === "string" ? v : null;
}

/** The task the run was given, read from the prompt event (it is cut at 2,000 characters in the log). Empty when unknown. */
export function taskOf(events: Pick<RunEvent, "kind" | "text">[]): string {
  const text = events.find((e) => e.kind === "prompt")?.text ?? "";
  const at = text.lastIndexOf("\n\nTask: ");
  return at < 0 ? "" : text.slice(at + "\n\nTask: ".length).trim();
}
