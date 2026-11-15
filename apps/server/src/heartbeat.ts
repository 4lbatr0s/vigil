import { createHash } from "node:crypto";
import { noteHashes } from "./index-db";

export type HashDiff = { added: string[]; changed: string[]; removed: string[] };

/** Above this many notes a single combined signature replaces the per-note list. */
export const MAX_TRACKED_NOTES = 5000;
/** The one key of a combined signature. */
export const COMBINED = "*";
const LIST_CAP = 50;

export function diffHashes(prev: Record<string, string>, next: Record<string, string>): HashDiff {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [id, hash] of Object.entries(next)) {
    if (!(id in prev)) added.push(id);
    else if (prev[id] !== hash) changed.push(id);
  }
  for (const id of Object.keys(prev)) if (!(id in next)) removed.push(id);
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}

export function isEmptyDiff(diff: HashDiff): boolean {
  return diff.added.length + diff.changed.length + diff.removed.length === 0;
}

/** For a vault past the size guard: one sha256 of the sorted `id:hash` lines instead of a map entry per note. */
export function combinedSignature(hashes: Record<string, string>): Record<string, string> {
  const lines = Object.entries(hashes)
    .map(([id, h]) => `${id}:${h}`)
    .sort();
  return { [COMBINED]: createHash("sha256").update(lines.join("\n")).digest("hex") };
}

/** The hashes a heartbeat compares: notes this agent last wrote are left out, so it never reacts to itself. */
export function visibleHashes(agentName: string): Record<string, string> {
  const all = noteHashes(agentName);
  return Object.keys(all).length > MAX_TRACKED_NOTES ? combinedSignature(all) : all;
}

function listLine(label: string, ids: string[]): string {
  if (ids.length === 0) return "";
  const shown = ids.slice(0, LIST_CAP).join(", ");
  const more = ids.length > LIST_CAP ? ` and ${ids.length - LIST_CAP} more` : "";
  return `${label}: ${shown}${more}.`;
}

/** The task text for a heartbeat run: ids only, capped at 50 per list. */
export function heartbeatTask(diff: HashDiff): string {
  if (diff.changed.includes(COMBINED)) {
    return "Many notes changed since your last check. React according to your instructions.";
  }
  const lines = [listLine("Added", diff.added), listLine("Changed", diff.changed), listLine("Removed", diff.removed)].filter(Boolean);
  return `These notes changed since your last check. ${lines.join(" ")} React according to your instructions.`;
}
