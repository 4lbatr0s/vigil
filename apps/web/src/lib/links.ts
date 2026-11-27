/**
 * Links into Notes. Notes moved from `/` to `/notes` when Today became the home page (2026-11-26); every link to a note
 * is built here, so the path lives in one place.
 */
export const NOTES_PATH = "/notes";

/** The three ways to see your notes, switched from the top of each (ViewSwitch). */
export const NOTE_VIEWS = [
  { href: NOTES_PATH, label: "List" },
  { href: "/graph", label: "Graph" },
  { href: "/canvas", label: "Boards" },
];

/** Query keys the Notes page reads. An old `/` link with one of them is a Notes link. */
const NOTES_KEYS = ["note", "daily", "new", "template", "line"];

export function noteHref(id: string, line?: number): string {
  return `${NOTES_PATH}?note=${encodeURIComponent(id)}${line ? `&line=${line}` : ""}`;
}

export function dailyHref(day: string): string {
  return `${NOTES_PATH}?daily=${day}`;
}

/** Where an old Notes link on `/` should go now, or null when `url` is a plain visit to Today. */
export function notesRedirect(url: URL): string | null {
  if (url.pathname !== "/" || !NOTES_KEYS.some((k) => url.searchParams.has(k))) return null;
  return `${NOTES_PATH}${url.search}`;
}
