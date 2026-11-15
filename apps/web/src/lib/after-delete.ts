/** Which note to open after `id` is deleted: the one below it in the list, else the one above, else none. */
export function nextAfterDelete(ids: string[], id: string): string | null {
  const i = ids.indexOf(id);
  if (i < 0) return ids[0] ?? null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}
