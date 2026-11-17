import { EditorView } from "@codemirror/view";

/** `[selected words](address)` when a web address is pasted over a selection on one line; null otherwise (a normal paste). */
export function linkFromPaste(selected: string, pasted: string): string | null {
  if (selected.trim() === "" || selected.includes("\n")) return null;
  const url = pasted.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return null;
  return `[${selected.replace(/[[\]]/g, "")}](${url})`;
}

/** Pasting a web address over selected text makes it a link, as in Notion and Obsidian. */
export const linkPaste = EditorView.domEventHandlers({
  paste(event, view) {
    const sel = view.state.selection.main;
    if (sel.empty) return false;
    const link = linkFromPaste(view.state.sliceDoc(sel.from, sel.to), event.clipboardData?.getData("text/plain") ?? "");
    if (link === null) return false;
    event.preventDefault();
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: link }, selection: { anchor: sel.from + link.length }, userEvent: "input.paste" });
    return true;
  },
});
