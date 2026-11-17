/**
 * Lucide icons for places Svelte components cannot reach (CodeMirror widgets): the same icon shapes as @lucide/svelte
 * (ISC licence), kept here as plain data so tests and the editor need no Svelte compiler to draw them.
 */
type IconData = { node: readonly (readonly [string, Record<string, string>])[] };

const check: IconData = { node: [["path", { d: "M20 6 9 17l-5-5" }]] };
const circleCheck: IconData = { node: [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "m16 9-5.5 5.5L8 12" }]] };
const copy: IconData = { node: [["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }], ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }]] };
const info: IconData = { node: [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M12 16v-4" }], ["path", { d: "M12 8h.01" }]] };
const lightbulb: IconData = { node: [["path", { d: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" }], ["path", { d: "M9 18h6" }], ["path", { d: "M10 22h4" }]] };
const octagonAlert: IconData = { node: [["path", { d: "M12 16h.01" }], ["path", { d: "M12 8v4" }], ["path", { d: "M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z" }]] };
const triangleAlert: IconData = { node: [["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }], ["path", { d: "M12 9v4" }], ["path", { d: "M12 17h.01" }]] };

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

export const ICONS = { check, copy, info, lightbulb, circleCheck, triangleAlert, octagonAlert } as const;

/** The icon and plain label for a callout type like `[!tip]`; unknown types look like a note. */
export function calloutLook(type: string): { icon: IconData; label: string; tone: "note" | "tip" | "warn" | "danger" | "ok" } {
  const t = type.toLowerCase();
  if (t === "tip" || t === "hint" || t === "important") return { icon: lightbulb, label: t === "important" ? "Important" : t === "hint" ? "Hint" : "Tip", tone: "tip" };
  if (t === "warning" || t === "caution" || t === "attention") return { icon: triangleAlert, label: t === "caution" ? "Caution" : t === "attention" ? "Attention" : "Warning", tone: "warn" };
  if (t === "danger" || t === "error" || t === "bug" || t === "failure") return { icon: octagonAlert, label: t === "bug" ? "Bug" : t === "failure" ? "Failure" : t === "error" ? "Error" : "Danger", tone: "danger" };
  if (t === "success" || t === "check" || t === "done") return { icon: circleCheck, label: t === "done" ? "Done" : t === "check" ? "Check" : "Success", tone: "ok" };
  return { icon: info, label: t === "note" ? "Note" : type.charAt(0).toUpperCase() + type.slice(1).toLowerCase(), tone: "note" };
}
