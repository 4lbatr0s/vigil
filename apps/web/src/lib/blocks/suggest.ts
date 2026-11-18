import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { exitSuggestion } from "@tiptap/suggestion";
import type { ICONS } from "../editor/icons";

/** One line in a pop-up list under the caret: the `/` menu and the `[[` note picker. */
export type PopupItem = { key: string; label: string; detail?: string; group?: string; icon?: keyof typeof ICONS };
export type Popup = { items: PopupItem[]; index: number; left: number; top: number; bottom: number; choose: (i: number) => void };

type Options<T> = {
  name: string;
  char: string;
  allowSpaces?: boolean;
  allow?: (args: { editor: Editor; range: Range }) => boolean;
  items: (query: string) => T[];
  describe: (item: T) => PopupItem;
  pick: (editor: Editor, range: Range, item: T) => void;
  /** The page's pop-up: called with the list to show, or null to hide it. */
  show: (popup: Popup | null) => void;
};

/** A trigger character that opens a pop-up list; arrow keys, Enter and Tab choose, Escape closes. */
export function suggest<T>(o: Options<T>): Extension {
  const key = new PluginKey(`suggest-${o.name}`);
  return Extension.create({
    name: `suggest-${o.name}`,
    addProseMirrorPlugins() {
      return [
        Suggestion<T, T>({
          editor: this.editor,
          pluginKey: key,
          char: o.char,
          allowSpaces: o.allowSpaces ?? false,
          allowedPrefixes: null,
          allow: o.allow ? ({ editor, range }) => o.allow?.({ editor, range }) ?? true : () => true,
          items: ({ query }) => o.items(query),
          command: ({ editor, range, props }) => o.pick(editor, range, props),
          render: () => {
            let list: T[] = [];
            let index = 0;
            let rect: (() => DOMRect | null) | null | undefined;
            let run: ((item: T) => void) | undefined;
            const push = (): void => {
              const r = rect?.();
              if (list.length === 0 || !r) {
                o.show(null);
                return;
              }
              o.show({ items: list.map(o.describe), index, left: r.left, top: r.top, bottom: r.bottom, choose: (i) => { const item = list[i]; if (item !== undefined) run?.(item); } });
            };
            return {
              onStart: (p) => {
                list = p.items;
                index = 0;
                rect = p.clientRect;
                run = p.command;
                push();
              },
              onUpdate: (p) => {
                list = p.items;
                index = Math.min(index, Math.max(0, list.length - 1));
                rect = p.clientRect;
                run = p.command;
                push();
              },
              onKeyDown: ({ event, view }) => {
                if (event.key === "Escape") {
                  exitSuggestion(view, key);
                  o.show(null);
                  return true;
                }
                if (list.length === 0) return false;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  index = (index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
                  push();
                  return true;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  const item = list[index];
                  if (item !== undefined) run?.(item);
                  return true;
                }
                return false;
              },
              onExit: () => o.show(null),
            };
          },
        }),
      ];
    },
  });
}
