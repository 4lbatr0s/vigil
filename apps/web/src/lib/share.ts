/** One inbox line from what another app shared: its text, then its title and link when they add something. Empty when nothing usable. */
export function shareLine(params: URLSearchParams): string {
  const clip = (name: string, max: number): string => (params.get(name) ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const text = clip("text", 1500);
  const title = clip("title", 200);
  const url = /^https?:\/\//i.test(clip("url", 500)) ? clip("url", 500) : "";
  // Some apps put the link in the text field and repeat it in url: do not write it twice.
  const parts = [text, title && !text.includes(title) ? title : "", url && !text.includes(url) ? url : ""].filter((p) => p !== "");
  return parts.join(" — ").slice(0, 2000);
}
