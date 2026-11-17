import type { NoteSummary } from "@vigil/shared";

export type SortKey = "modified" | "title";

/** Whether a note is under `tag`: the tag itself or any child (`work` matches `work/launch`). */
export function hasTag(note: NoteSummary, tag: string): boolean {
  return note.tags.some((t) => t === tag || t.startsWith(`${tag}/`));
}

/** Case-insensitive match on title, snippet and tags. An empty query matches everything. */
export function matchesQuery(note: NoteSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return note.title.toLowerCase().includes(q) || (note.snippet ?? "").toLowerCase().includes(q) || note.tags.some((t) => t.includes(q.replace(/^#/, "")));
}

export type ListView = { query: string; tag: string | null; sort: SortKey; pins: readonly string[]; extraIds?: ReadonlySet<string> };

/**
 * What the list shows: filtered by tag and query (`extraIds` are full-text hits from the server that the
 * client-side match would miss), pinned notes first in pin order, then the rest in the chosen sort.
 */
export function viewNotes(notes: readonly NoteSummary[], view: ListView): NoteSummary[] {
  const pinOrder = new Map(view.pins.map((id, i) => [id, i]));
  const shown = notes.filter((n) => (view.tag === null || hasTag(n, view.tag)) && (matchesQuery(n, view.query) || view.extraIds?.has(n.id) === true));
  const rest = shown.filter((n) => !pinOrder.has(n.id));
  if (view.sort === "title") rest.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  // "modified" keeps the server order (newest first).
  const pinned = shown.filter((n) => pinOrder.has(n.id)).sort((a, b) => (pinOrder.get(a.id) ?? 0) - (pinOrder.get(b.id) ?? 0));
  return [...pinned, ...rest];
}

/** The most used tags, most used first, ties by name. Only top-level counts matter for the chips: nested tags count under their own path. */
export function tagCounts(notes: readonly NoteSummary[], limit = 12): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

/** "just now", "4 min ago", "2 h ago", "yesterday", "3 d ago", then the date (ux-spec section 2). */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const sec = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(sec / 86400);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} d ago`;
  return then.toISOString().slice(0, 10);
}

/** How far away a coming time is: `in 5 h`, `tomorrow`, `in 3 days`. Times already past read as `now`. */
export function untilText(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const sec = Math.round((then.getTime() - now.getTime()) / 1000);
  if (sec < 60) return "now";
  const min = Math.round(sec / 60);
  if (min < 60) return `in ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(sec / 86400);
  return days <= 1 ? "tomorrow" : `in ${days} days`;
}
