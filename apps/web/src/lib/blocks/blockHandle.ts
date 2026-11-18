import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { ICONS, iconElement } from "../editor/icons";
import { moveUnit, siblingStarts, unitAt, type Unit } from "./moves";

type Options = {
  /** The grip was clicked (not dragged): the page shows the block menu for the block that starts at `from`. */
  onMenu: (at: { x: number; y: number }, from: number) => void;
  /** The plus was clicked: a new line goes below the block that starts at `from`. */
  onAdd: (from: number) => void;
};

/**
 * A plus and a grip in the margin beside the block under the pointer. The grip picks the block up (a drop line shows
 * where it will land) or, when only clicked, opens the block menu. The note changes only when a block is dropped.
 */
export function blockHandle(options: Options): Extension {
  return Extension.create({
    name: "blockHandle",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          view: (view) => {
            const host = view.dom.parentElement;
            if (!host) return {};
            return mount(view, host, options);
          },
        }),
      ];
    },
  });
}

function button(label: string, icon: keyof typeof ICONS): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.title = label;
  b.append(iconElement(ICONS[icon], 16));
  return b;
}

function mount(view: EditorView, host: HTMLElement, options: Options): { update: () => void; destroy: () => void } {
  const bar = document.createElement("div");
  bar.className = "bh";
  const add = button("Add a block below", "plus");
  const grip = button("Drag to move, click for options", "grip");
  bar.append(add, grip);
  const line = document.createElement("div");
  line.className = "bh-line";
  host.append(bar, line);

  let at = -1;
  let drag: { unit: Unit; startY: number; moved: boolean; gap: number } | null = null;

  const hide = (): void => {
    if (drag) return;
    bar.classList.remove("on");
    at = -1;
  };

  const place = (unit: Unit): void => {
    const dom = view.nodeDOM(unit.from);
    if (!(dom instanceof HTMLElement)) return hide();
    const box = host.getBoundingClientRect();
    const r = dom.getBoundingClientRect();
    bar.style.top = `${r.top - box.top + 3}px`;
    bar.classList.add("on");
    at = unit.from;
  };

  const onMove = (e: MouseEvent): void => {
    if (drag) return;
    const content = view.dom.getBoundingClientRect();
    const found = view.posAtCoords({ left: content.left + 12, top: e.clientY });
    if (!found) return hide();
    const unit = unitAt(view.state.doc, found.inside >= 0 ? found.inside : found.pos);
    if (!unit) return hide();
    if (unit.from !== at) place(unit);
  };

  const gapFor = (unit: Unit, y: number): { gap: number; y: number } => {
    const starts = siblingStarts(unit);
    for (let i = 0; i < starts.length; i++) {
      const dom = view.nodeDOM(starts[i] ?? 0);
      if (!(dom instanceof HTMLElement)) continue;
      const r = dom.getBoundingClientRect();
      if (y < r.top + r.height / 2) return { gap: i, y: r.top };
    }
    const last = view.nodeDOM(starts[starts.length - 1] ?? 0);
    return { gap: starts.length, y: last instanceof HTMLElement ? last.getBoundingClientRect().bottom : 0 };
  };

  const onDown = (e: PointerEvent): void => {
    const unit = at >= 0 ? unitAt(view.state.doc, at + 1) : null;
    if (!unit) return;
    e.preventDefault();
    drag = { unit, startY: e.clientY, moved: false, gap: unit.index };
    grip.setPointerCapture(e.pointerId);
  };

  const onDrag = (e: PointerEvent): void => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientY - drag.startY) < 5) return;
    drag.moved = true;
    document.body.classList.add("bh-dragging");
    const { gap, y } = gapFor(drag.unit, e.clientY);
    drag.gap = gap;
    const box = host.getBoundingClientRect();
    line.style.top = `${y - box.top}px`;
    line.classList.add("on");
  };

  const onUp = (e: PointerEvent): void => {
    if (!drag) return;
    const d = drag;
    drag = null;
    document.body.classList.remove("bh-dragging");
    line.classList.remove("on");
    grip.releasePointerCapture(e.pointerId);
    if (d.moved) {
      const tr = view.state.tr;
      if (moveUnit(tr, d.unit, d.gap)) view.dispatch(tr.scrollIntoView());
      view.focus();
    } else {
      options.onMenu({ x: e.clientX, y: e.clientY }, d.unit.from);
    }
    hide();
  };

  const onAdd = (e: MouseEvent): void => {
    e.preventDefault();
    if (at >= 0) options.onAdd(at);
  };

  host.addEventListener("mousemove", onMove);
  host.addEventListener("mouseleave", hide);
  grip.addEventListener("pointerdown", onDown);
  grip.addEventListener("pointermove", onDrag);
  grip.addEventListener("pointerup", onUp);
  add.addEventListener("mousedown", onAdd);

  return {
    update: () => {
      // Typing changes positions, so the handle waits for the next pointer move.
      if (!drag) hide();
    },
    destroy: () => {
      host.removeEventListener("mousemove", onMove);
      host.removeEventListener("mouseleave", hide);
      bar.remove();
      line.remove();
    },
  };
}
