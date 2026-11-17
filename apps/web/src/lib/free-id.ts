/**
 * A note id that no existing note uses: `base`, or `base-2`, `base-3`… Creating from a page must never
 * replace a note the learner already has, so callers pick the id with this before saving.
 */
export function freeId(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
