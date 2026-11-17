/** The id and title of the daily note for `now`, in the viewer's own time zone: `2026-11-17`. */
export function dailyNote(now: Date = new Date()): { id: string; title: string } {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return { id: day, title: day };
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-11-17` as a real calendar day, or null for anything else (including `2026-02-30`). */
export function parseDay(text: string): Date | null {
  const m = DAY.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}
