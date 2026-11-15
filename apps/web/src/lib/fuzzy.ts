/**
 * Score how well `query` matches `text`, or null for no match. Tiers: prefix beats a match at the
 * start of a later word, which beats any other substring. Shorter text and earlier hits score higher.
 * An empty query matches everything with score 0.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at < 0) return null;
  if (at === 0) return 300 - Math.min(t.length - q.length, 99);
  const wordStart = t.search(new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  if (wordStart >= 0) return 200 - Math.min(wordStart, 99);
  return 100 - Math.min(at, 99);
}

export function rank<T>(items: T[], query: string, textOf: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, textOf(item)) }))
    .filter((x): x is { item: T; index: number; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.item);
}
