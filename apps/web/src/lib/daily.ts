/** The id and title of the daily note for `now`, in the viewer's own time zone: `2026-11-17`. */
export function dailyNote(now: Date = new Date()): { id: string; title: string } {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return { id: day, title: day };
}
