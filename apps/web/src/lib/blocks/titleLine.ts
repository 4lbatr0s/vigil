import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * A first heading that only repeats the note's title is hidden, because the page already shows the title above the
 * text. The heading stays in the note; it is just not drawn.
 */
export function titleLine(getTitle: () => string | undefined): Extension {
  return Extension.create({
    name: "titleLine",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            decorations(state) {
              const first = state.doc.firstChild;
              const title = getTitle()?.trim().toLowerCase();
              if (!first || !title || first.type.name !== "heading" || first.attrs.level !== 1) return null;
              if (first.textContent.trim().toLowerCase() !== title) return null;
              return DecorationSet.create(state.doc, [Decoration.node(0, first.nodeSize, { class: "title-dup" })]);
            },
          },
        }),
      ];
    },
  });
}
