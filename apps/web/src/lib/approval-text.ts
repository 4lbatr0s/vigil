import type { ApprovalItem } from "$lib/api";

/** One short phrase for what a waiting approval would do, for the row under its title. */
export function actionText(item: Pick<ApprovalItem, "tool" | "currentBody">): string {
  if (item.tool === "fetch_url") return "wants to read a web page";
  if (item.tool === "call_agent") return "wants to ask another helper";
  if (item.currentBody === null) return "creates a note";
  return item.tool === "append_note" ? "adds to the note" : "replaces the note";
}
