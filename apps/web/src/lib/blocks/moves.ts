import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/**
 * A block you can pick up with the handle: a top-level block (paragraph, heading, table, callout, code, quote,
 * divider, whole list) or one list item together with everything nested in it. Pure position maths over the
 * document; the editor applies what these return.
 */
export type Unit = { from: number; to: number; node: PMNode; index: number; count: number; parentStart: number; parent: PMNode };

const ITEM = new Set(["listItem", "taskItem"]);

export function unitAt(doc: PMNode, pos: number): Unit | null {
  const at = Math.max(0, Math.min(pos, doc.content.size));
  const $p = doc.resolve(at);
  for (let d = $p.depth; d >= 1; d--) {
    if (ITEM.has($p.node(d).type.name)) return make($p.node(d - 1), d - 1 === 0 ? 0 : $p.start(d - 1), $p.index(d - 1));
  }
  if ($p.depth >= 1) return make(doc, 0, $p.index(0));
  return $p.nodeAfter ? make(doc, 0, $p.index(0)) : null;
}

function make(parent: PMNode, parentStart: number, index: number): Unit | null {
  const node = parent.maybeChild(index);
  if (!node) return null;
  let from = parentStart;
  for (let i = 0; i < index; i++) from += parent.child(i).nodeSize;
  return { from, to: from + node.nodeSize, node, index, count: parent.childCount, parentStart, parent };
}

/** The start of each sibling, for putting a drop line between them. */
export function siblingStarts(u: Unit): number[] {
  const out: number[] = [];
  let at = u.parentStart;
  u.parent.forEach((child) => {
    out.push(at);
    at += child.nodeSize;
  });
  return out;
}

/** Moves the unit to the gap `gap` (0 is before the first sibling, `count` after the last). False when nothing would change. */
export function moveUnit(tr: Transaction, u: Unit, gap: number): boolean {
  if (gap < 0 || gap > u.count || gap === u.index || gap === u.index + 1) return false;
  const starts = siblingStarts(u);
  const dest = gap < u.count ? (starts[gap] ?? u.parentStart) : u.parentStart + u.parent.content.size;
  if (dest > u.from) {
    tr.insert(dest, u.node);
    tr.delete(u.from, u.to);
  } else {
    tr.delete(u.from, u.to);
    tr.insert(dest, u.node);
  }
  return true;
}

export function duplicateUnit(tr: Transaction, u: Unit): void {
  tr.insert(u.to, u.node);
}

/** Removes the unit; a list or document left with nothing gets an empty paragraph back so it stays valid. */
export function deleteUnit(tr: Transaction, u: Unit): void {
  if (u.count === 1 && u.parent.type.name === "doc") {
    tr.replaceWith(u.from, u.to, tr.doc.type.schema.nodes.paragraph?.create() ?? u.node);
    return;
  }
  tr.delete(u.from, u.to);
}
