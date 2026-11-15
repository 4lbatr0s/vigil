import { slugify } from "@vigil/shared";

const ID_LIKE = /^[a-z0-9][a-z0-9-]*$/;

/** `[[Title]]`, `[[Title#heading]]`, `[[Title|alias]]`: groups are the title and the `#...|...` rest. */
const WIKILINK = /\[\[([^\]|#]+)((?:#[^\]|]*)?(?:\|[^\]]*)?)\]\]/g;
/** `[text](target)`: groups are the text and the target. */
const MDLINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;

/**
 * The text with fenced code blocks and inline code blanked out (same length, newlines kept), so a
 * link inside code is neither extracted nor rewritten and every offset still lines up.
 */
export function stripCode(body: string): string {
  const blank = (s: string): string => s.replace(/[^\n]/g, " ");
  let out = body.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))/gm, blank);
  out = out.replace(/`[^`\n]+`/g, blank);
  return out;
}

/** The note id an md link target points at, or null for urls, anchors and anything that is not a note id. */
function mdTargetId(raw: string): string | null {
  const target = raw.trim();
  if (!target || target.includes("#")) return null;
  const candidate = target.replace(/^\.\//, "").replace(/\.md$/, "");
  return ID_LIKE.test(candidate) ? candidate : null;
}

/** Note ids a body links to, from [[wikilinks]] and [text](id) links. Targets need not exist. Code is skipped. */
export function extractLinks(body: string): string[] {
  const text = stripCode(body);
  const found = new Set<string>();
  for (const m of text.matchAll(WIKILINK)) {
    const slug = slugify((m[1] ?? "").trim());
    if (slug) found.add(slug);
  }
  for (const m of text.matchAll(MDLINK)) {
    const id = mdTargetId(m[2] ?? "");
    if (id) found.add(id);
  }
  return [...found];
}

type Edit = { from: number; to: number; insert: string };

/**
 * Rewrite links to `oldId` so they point at the renamed note: `[[Old title]]` becomes `[[New title]]`
 * (a `#heading` or `|alias` stays) and `[x](old-id)` / `[x](./old-id.md)` get the new id. Links in code
 * are untouched. Returns the new body and how many links changed.
 */
export function rewriteLinks(body: string, oldId: string, newId: string, newTitle: string): { body: string; count: number } {
  const text = stripCode(body);
  const edits: Edit[] = [];
  for (const m of text.matchAll(WIKILINK)) {
    if (slugify((m[1] ?? "").trim()) !== oldId) continue;
    const start = (m.index ?? 0) + 2;
    edits.push({ from: start, to: start + (m[1] ?? "").length, insert: newTitle });
  }
  for (const m of text.matchAll(MDLINK)) {
    const target = m[2] ?? "";
    if (mdTargetId(target) !== oldId) continue;
    const start = (m.index ?? 0) + 1 + (m[1] ?? "").length + 2; // after "[text]("
    const prefix = target.startsWith("./") ? "./" : "";
    const suffix = target.endsWith(".md") ? ".md" : "";
    edits.push({ from: start, to: start + target.length, insert: `${prefix}${newId}${suffix}` });
  }
  let out = body;
  for (const e of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return { body: out, count: edits.length };
}
