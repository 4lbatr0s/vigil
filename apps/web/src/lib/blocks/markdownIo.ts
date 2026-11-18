import { Editor } from "@tiptap/core";
import { blockExtensions, normalize } from "./extensions";

/** The note as the block editor would write it back, using a hidden editor that is never shown. */
export function throughEditor(md: string): string {
  const editor = new Editor({ element: document.createElement("div"), extensions: blockExtensions(), content: md, contentType: "markdown" });
  try {
    return editor.getMarkdown();
  } finally {
    editor.destroy();
  }
}

/**
 * True when the block editor would keep every word and block of this note. When it is false the note opens as plain
 * markdown instead, so nothing the person wrote is rewritten behind their back.
 */
export function roundTrips(md: string): boolean {
  return normalize(throughEditor(md)) === normalize(md);
}
