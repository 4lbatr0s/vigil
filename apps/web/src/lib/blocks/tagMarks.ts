import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const TAG = /(^|[\s(])(#[\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

/** `#tag` drawn as a small pill. Only drawn: the text stays plain text, so the note on disk never changes. */
export const tagMarks = Extension.create({
  name: "tagMarks",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const found: Decoration[] = [];
            state.doc.descendants((node, pos, parent) => {
              if (!node.isText || !node.text || parent?.type.name === "codeBlock" || node.marks.some((m) => m.type.name === "code")) return;
              for (const m of node.text.matchAll(TAG)) {
                const start = pos + (m.index ?? 0) + (m[1]?.length ?? 0);
                found.push(Decoration.inline(start, start + (m[2]?.length ?? 0), { class: "tag" }));
              }
            });
            return DecorationSet.create(state.doc, found);
          },
        },
      }),
    ];
  },
});
