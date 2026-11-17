import type { Extension, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { blockIndexAt, blocksOf } from "./blocks";

const DIM = Decoration.line({ class: "cm-dim" });

/** Focus mode: every line outside the block that holds the caret is dimmed, so one thought at a time stands out. */
function dimmed(view: EditorView): DecorationSet {
  const { state } = view;
  const blocks = blocksOf(state);
  const at = blockIndexAt(blocks, state.selection.main.head);
  const keep = blocks[at];
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) {
      const line = state.doc.line(n);
      if (keep && line.from >= keep.from && line.to <= keep.to) continue;
      out.push(DIM.range(line.from));
    }
  }
  return Decoration.set(out, true);
}

export const focusMode: Extension = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = dimmed(view);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = dimmed(update.view);
      }
    },
    { decorations: (v) => v.decorations },
  ),
  EditorView.baseTheme({ ".cm-dim": { opacity: "0.35", transition: "opacity 150ms ease" }, "@media (prefers-reduced-motion: reduce)": { ".cm-dim": { transition: "none" } } }),
];
