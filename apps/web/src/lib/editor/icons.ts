/**
 * Lucide icons for places Svelte components cannot reach (CodeMirror widgets): the same icon shapes as @lucide/svelte
 * (ISC licence), kept here as plain data so tests and the editor need no Svelte compiler to draw them.
 */
type IconData = { node: readonly (readonly [string, Record<string, string>])[] };

const check: IconData = { node: [["path", { d: "M20 6 9 17l-5-5" }]] };
const circleCheck: IconData = { node: [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "m16 9-5.5 5.5L8 12" }]] };
const copy: IconData = { node: [["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }], ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }]] };
const plus: IconData = { node: [["path", { d: "M5 12h14" }], ["path", { d: "M12 5v14" }]] };
const grip: IconData = { node: [["circle", { cx: "9", cy: "12", r: "1" }], ["circle", { cx: "9", cy: "5", r: "1" }], ["circle", { cx: "9", cy: "19", r: "1" }], ["circle", { cx: "15", cy: "12", r: "1" }], ["circle", { cx: "15", cy: "5", r: "1" }], ["circle", { cx: "15", cy: "19", r: "1" }]] };
const info: IconData = { node: [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M12 16v-4" }], ["path", { d: "M12 8h.01" }]] };
const lightbulb: IconData = { node: [["path", { d: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" }], ["path", { d: "M9 18h6" }], ["path", { d: "M10 22h4" }]] };
const octagonAlert: IconData = { node: [["path", { d: "M12 16h.01" }], ["path", { d: "M12 8v4" }], ["path", { d: "M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z" }]] };
const triangleAlert: IconData = { node: [["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }], ["path", { d: "M12 9v4" }], ["path", { d: "M12 17h.01" }]] };

const heading1: IconData = { node: [["path", { d: "M4 12h8" }], ["path", { d: "M4 18V6" }], ["path", { d: "M12 18V6" }], ["path", { d: "m17 12 3-2v8" }]] };
const heading2: IconData = { node: [["path", { d: "M4 12h8" }], ["path", { d: "M4 18V6" }], ["path", { d: "M12 18V6" }], ["path", { d: "M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1" }]] };
const heading3: IconData = { node: [["path", { d: "M4 12h8" }], ["path", { d: "M4 18V6" }], ["path", { d: "M12 18V6" }], ["path", { d: "M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2" }], ["path", { d: "M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2" }]] };
const list: IconData = { node: [["path", { d: "M3 5h.01" }], ["path", { d: "M3 12h.01" }], ["path", { d: "M3 19h.01" }], ["path", { d: "M8 5h13" }], ["path", { d: "M8 12h13" }], ["path", { d: "M8 19h13" }]] };
const listOrdered: IconData = { node: [["path", { d: "M11 5h10" }], ["path", { d: "M11 12h10" }], ["path", { d: "M11 19h10" }], ["path", { d: "M4 4h1v5" }], ["path", { d: "M4 9h2" }], ["path", { d: "M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02" }]] };
const listTodo: IconData = { node: [["path", { d: "M13 5h8" }], ["path", { d: "M13 12h8" }], ["path", { d: "M13 19h8" }], ["path", { d: "m3 17 2 2 4-4" }], ["rect", { x: "3", y: "4", width: "6", height: "6", rx: "1" }]] };
const textQuote: IconData = { node: [["path", { d: "M17 5H3" }], ["path", { d: "M21 12H8" }], ["path", { d: "M21 19H8" }], ["path", { d: "M3 12v7" }]] };
const code: IconData = { node: [["path", { d: "m16 18 6-6-6-6" }], ["path", { d: "m8 6-6 6 6 6" }]] };
const table: IconData = { node: [["path", { d: "M12 3v18" }], ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }], ["path", { d: "M3 9h18" }], ["path", { d: "M3 15h18" }]] };
const minus: IconData = { node: [["path", { d: "M5 12h14" }]] };
const chevronRight: IconData = { node: [["path", { d: "m9 18 6-6-6-6" }]] };
const image: IconData = { node: [["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2" }], ["circle", { cx: "9", cy: "9", r: "2" }], ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" }]] };
const link: IconData = { node: [["path", { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" }], ["path", { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" }]] };
const calendar: IconData = { node: [["path", { d: "M8 2v3" }], ["path", { d: "M16 2v3" }], ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }], ["path", { d: "M3 9h18" }]] };
const bot: IconData = { node: [["path", { d: "M12 8V4H8" }], ["rect", { width: "16", height: "12", x: "4", y: "8", rx: "2" }], ["path", { d: "M2 14h2" }], ["path", { d: "M20 14h2" }], ["path", { d: "M15 13v2" }], ["path", { d: "M9 13v2" }]] };
const brain: IconData = { node: [["path", { d: "M12 18V5" }], ["path", { d: "M15 13a4.17 4.17 0 01-3-4 4.17 4.17 0 01-3 4" }], ["path", { d: "M17.707 6.294A3 3 0 1012 5a3 3 0 10-5.707 1.294" }], ["path", { d: "M17.996 5.125a4 4 0 012.526 5.77" }], ["path", { d: "M18 18a4 4 0 002-7.465" }], ["path", { d: "M19.967 17.482a4 4 0 11-7.967.517 4 4 0 11-7.967-.517" }], ["path", { d: "M6 18a4 4 0 01-2-7.465" }], ["path", { d: "M6.004 5.125a4 4 0 00-2.526 5.77" }]] };
const type: IconData = { node: [["path", { d: "M12 4v16" }], ["path", { d: "M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" }], ["path", { d: "M9 20h6" }]] };
const pilcrow: IconData = { node: [["path", { d: "M13 4v16" }], ["path", { d: "M17 4v16" }], ["path", { d: "M19 4H9.5a4.5 4.5 0 0 0 0 9H13" }]] };
const arrowUp: IconData = { node: [["path", { d: "m5 12 7-7 7 7" }], ["path", { d: "M12 19V5" }]] };
const arrowDown: IconData = { node: [["path", { d: "M12 5v14" }], ["path", { d: "m19 12-7 7-7-7" }]] };
const chevronsDownUp: IconData = { node: [["path", { d: "m7 20 5-5 5 5" }], ["path", { d: "m7 4 5 5 5-5" }]] };

const SVG = "http://www.w3.org/2000/svg";

export function iconElement(data: IconData, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of data.node) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

export const ICONS = { heading1, heading2, heading3, list, listOrdered, listTodo, textQuote, code, table, minus, chevronRight, image, link, calendar, bot, brain, type, pilcrow, arrowUp, arrowDown, chevronsDownUp, check, copy, plus, grip, info, lightbulb, circleCheck, triangleAlert, octagonAlert } as const;

/** The icon and plain label for a callout type like `[!tip]`; unknown types look like a note. */
export function calloutLook(type: string): { icon: IconData; label: string; tone: "note" | "tip" | "warn" | "danger" | "ok" } {
  const t = type.toLowerCase();
  if (t === "tip" || t === "hint" || t === "important") return { icon: lightbulb, label: t === "important" ? "Important" : t === "hint" ? "Hint" : "Tip", tone: "tip" };
  if (t === "warning" || t === "caution" || t === "attention") return { icon: triangleAlert, label: t === "caution" ? "Caution" : t === "attention" ? "Attention" : "Warning", tone: "warn" };
  if (t === "danger" || t === "error" || t === "bug" || t === "failure") return { icon: octagonAlert, label: t === "bug" ? "Bug" : t === "failure" ? "Failure" : t === "error" ? "Error" : "Danger", tone: "danger" };
  if (t === "success" || t === "check" || t === "done") return { icon: circleCheck, label: t === "done" ? "Done" : t === "check" ? "Check" : "Success", tone: "ok" };
  return { icon: info, label: t === "note" ? "Note" : type.charAt(0).toUpperCase() + type.slice(1).toLowerCase(), tone: "note" };
}
