import { Editor } from "@tiptap/core";
import { blockExtensions, normalize } from "./extensions";

/** The note as the block editor would write it back, using a hidden editor that is never shown. */
export function throughEditor(md: string): string {
  const editor = new Editor({ element: document.createElement("div"), extensions: blockExtensions(), content: md, contentType: "markdown" });
  try {
    return tidyMarkdown(editor.getMarkdown());
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

/**
 * The markdown the editor wrote, tidied: no run of blank lines between blocks (code is left exactly as it is) and
 * one line break at the end, like the files Vigil writes itself.
 */
export function tidyMarkdown(md: string): string {
  const out: string[] = [];
  let fence = false;
  let blank = 0;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && line.trim() === "") {
      blank += 1;
      if (blank > 1) continue;
    } else {
      blank = 0;
    }
    out.push(line);
  }
  const text = out.join("\n").replace(/\n+$/, "");
  return text === "" ? "" : `${text}\n`;
}
