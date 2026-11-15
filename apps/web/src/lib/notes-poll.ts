import type { Note } from "@vigil/shared";

/**
 * Ids of agent-written notes that are new or newer in `next` than in `prev`. The first load
 * (`prev` null) never counts, so nothing flickers when the page opens.
 */
export function newAgentNotes(prev: Note[] | null, next: Note[]): string[] {
  if (prev === null) return [];
  const before = new Map(prev.map((n) => [n.id, n.updatedAt]));
  return next
    .filter((n) => {
      if (n.author !== "agent") return false;
      const old = before.get(n.id);
      return old === undefined || Date.parse(n.updatedAt) > Date.parse(old);
    })
    .map((n) => n.id);
}
