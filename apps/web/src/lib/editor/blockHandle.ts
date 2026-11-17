import { startCompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type Block, blockIndexAt, blocksOf, moveBlock, movedBlockStart } from "./blocks";
import { iconElement, ICONS } from "./icons";

/**
 * The handle in the left margin of the block under the pointer, as in Notion: a plus that adds a block below and
 * opens the `/` menu, and a grip that drags the block to a new place or, when clicked, opens the block menu
 * (`onMenu`, with the screen position and the block's index). It is plain DOM over the editor; the note only
 * changes when a drop is applied through `moveBlock`.
 */
export function blockHandle(options: { onMenu: (at: { x: number; y: number }, index: number) => void }): Extension {
  return ViewPlugin.fromClass(
    class {
      readonly bar = document.createElement("div");
      readonly line = document.createElement("div");
      private cache: { doc: unknown; blocks: Block[] } | null = null;
      private shown = -1;
      private dragging: { index: number; startY: number; moved: boolean; target: number; after: boolean } | null = null;

      constructor(readonly view: EditorView) {
        this.bar.className = "cm-blockhandle";
        this.line.className = "cm-dropline";
        const plus = this.button("Add a block below", ICONS.plus);
        const grip = this.button("Drag to move, click for the block menu", ICONS.grip);
        this.bar.append(plus, grip);
        view.dom.append(this.bar, this.line);

        plus.addEventListener("pointerdown", (e) => e.preventDefault());
        plus.addEventListener("click", () => this.addBelow());
        grip.addEventListener("pointerdown", (e) => this.gripDown(e, grip));
        grip.addEventListener("pointermove", (e) => this.gripMove(e));
        grip.addEventListener("pointerup", (e) => this.gripUp(e, grip));
        grip.addEventListener("pointercancel", () => this.endDrag());
        view.dom.addEventListener("mousemove", this.onMove);
        view.dom.addEventListener("mouseleave", this.onLeave);
      }

      private button(label: string, icon: Parameters<typeof iconElement>[0]): HTMLButtonElement {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("aria-label", label);
        b.title = label;
        b.tabIndex = -1; // the keyboard has Alt+Up and Alt+Down, and the slash menu
        b.append(iconElement(icon, 16));
        return b;
      }

      private blocks(): Block[] {
        const doc = this.view.state.doc;
        if (!this.cache || this.cache.doc !== doc) this.cache = { doc, blocks: blocksOf(this.view.state) };
        return this.cache.blocks;
      }

      private blockAtY(y: number): number {
        const rect = this.view.contentDOM.getBoundingClientRect();
        const pos = this.view.posAtCoords({ x: rect.left + 8, y }, false);
        return blockIndexAt(this.blocks(), pos);
      }

      private show(index: number): void {
        const b = this.blocks()[index];
        if (!b) return this.hide();
        const at = this.view.coordsAtPos(b.from);
        if (!at) return this.hide();
        const box = this.view.dom.getBoundingClientRect();
        const height = Math.max(24, Math.min(at.bottom - at.top, 40));
        this.bar.style.top = `${at.top - box.top + (at.bottom - at.top - height) / 2}px`;
        this.bar.style.height = `${height}px`;
        this.bar.classList.add("on");
        this.shown = index;
      }

      private hide(): void {
        if (this.dragging?.moved) return;
        this.bar.classList.remove("on");
        this.shown = -1;
      }

      private onMove = (e: MouseEvent): void => {
        if (this.dragging) return;
        if ((e.target as HTMLElement).closest(".cm-blockhandle")) return;
        const i = this.blockAtY(e.clientY);
        if (i < 0) this.hide();
        else if (i !== this.shown) this.show(i);
      };
      private onLeave = (): void => this.hide();

      private addBelow(): void {
        const b = this.blocks()[this.shown];
        if (!b) return;
        const insert = `\n\n/`;
        this.view.dispatch({ changes: { from: b.to, insert }, selection: { anchor: b.to + insert.length }, userEvent: "input" });
        this.view.focus();
        startCompletion(this.view);
      }

      private gripDown(e: PointerEvent, grip: HTMLElement): void {
        e.preventDefault();
        if (this.shown < 0) return;
        grip.setPointerCapture(e.pointerId);
        this.dragging = { index: this.shown, startY: e.clientY, moved: false, target: this.shown, after: false };
      }

      private gripMove(e: PointerEvent): void {
        const d = this.dragging;
        if (!d) return;
        if (!d.moved && Math.abs(e.clientY - d.startY) < 4) return;
        d.moved = true;
        this.view.dom.classList.add("cm-dragging");
        const blocks = this.blocks();
        let j = this.blockAtY(e.clientY);
        if (j < 0) {
          // Between blocks: aim at the nearest one above the pointer.
          const rect = this.view.contentDOM.getBoundingClientRect();
          const pos = this.view.posAtCoords({ x: rect.left + 8, y: e.clientY }, false);
          j = Math.max(0, blocks.findLastIndex((b) => b.to < pos));
        }
        const target = blocks[j];
        if (!target) return;
        const top = this.view.coordsAtPos(target.from);
        const bottom = this.view.coordsAtPos(target.to);
        if (!top || !bottom) return;
        const mid = (top.top + bottom.bottom) / 2;
        d.target = j;
        d.after = e.clientY > mid;
        const box = this.view.dom.getBoundingClientRect();
        this.line.style.top = `${(d.after ? bottom.bottom : top.top) - box.top - 1}px`;
        this.line.classList.add("on");
      }

      private gripUp(e: PointerEvent, grip: HTMLElement): void {
        const d = this.dragging;
        grip.releasePointerCapture(e.pointerId);
        if (!d) return;
        if (!d.moved) {
          this.endDrag();
          options.onMenu({ x: e.clientX, y: e.clientY }, d.index);
          return;
        }
        const blocks = this.blocks();
        const changes = moveBlock(this.view.state, blocks, d.index, d.target, d.after);
        this.endDrag();
        if (changes.length === 0) return;
        const set = this.view.state.changes(changes);
        this.view.dispatch({ changes, selection: { anchor: movedBlockStart(blocks, d.index, d.target, d.after, set) }, userEvent: "move", scrollIntoView: true });
        this.view.focus();
      }

      private endDrag(): void {
        this.dragging = null;
        this.view.dom.classList.remove("cm-dragging");
        this.line.classList.remove("on");
        this.bar.classList.remove("on");
        this.shown = -1;
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) {
          this.cache = null;
          if (!this.dragging) this.hide();
        }
      }

      destroy(): void {
        this.view.dom.removeEventListener("mousemove", this.onMove);
        this.view.dom.removeEventListener("mouseleave", this.onLeave);
        this.bar.remove();
        this.line.remove();
      }
    },
  );
}

/** Alt+Up and Alt+Down: move the block that holds the caret one block up or down, and keep the caret in it. */
export function moveBlockByKey(view: EditorView, delta: -1 | 1): boolean {
  const blocks = blocksOf(view.state);
  const head = view.state.selection.main.head;
  const i = blockIndexAt(blocks, head);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= blocks.length) return true; // handled: nothing to move, and the key does not scroll the page
  const changes = moveBlock(view.state, blocks, i, j, delta > 0);
  if (changes.length === 0) return true;
  const a = blocks[i];
  const set = view.state.changes(changes);
  const start = movedBlockStart(blocks, i, j, delta > 0, set);
  view.dispatch({ changes, selection: { anchor: start + Math.max(0, head - (a?.from ?? head)) }, userEvent: "move", scrollIntoView: true });
  return true;
}
