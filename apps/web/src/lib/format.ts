/** "15 Nov 07:00" in the viewer's own time zone; empty text for a missing time. */
export function formatStamp(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  return `${day} ${time}`;
}
