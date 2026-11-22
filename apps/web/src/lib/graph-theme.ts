/**
 * Colours for the graph, as plain `#rrggbb` or `rgba()` strings. Sigma (WebGL) cannot parse the oklch and
 * light-dark() values the design tokens use, so each token is resolved by the browser and read back as pixels.
 */
export type GraphTheme = {
  /** A note dot. */
  note: string;
  /** A dimmed note, a ghost and a link line. */
  line: string;
  /** The page behind the graph. */
  paper: string;
  /** Strong text and the focused note. */
  text: string;
  /** Agent activity (amber). */
  agent: string;
  good: string;
  danger: string;
  /** Six colours for tags. */
  palette: string[];
};

let scratch: CanvasRenderingContext2D | null = null;

/** A CSS colour (a token, `var(--x)`, color-mix, light-dark) as `#rrggbb`, or `rgba()` when it is see-through. */
export function resolveColor(value: string): string {
  const probe = document.createElement("span");
  probe.style.color = value;
  probe.style.display = "none";
  document.documentElement.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  scratch ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const ctx = scratch;
  if (!ctx) return computed;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = computed;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = ctx.getImageData(0, 0, 1, 1).data;
  const hex = (n: number): string => n.toString(16).padStart(2, "0");
  return a === 255 ? `#${hex(r)}${hex(g)}${hex(b)}` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

/** The theme for the page as it looks right now (light or dark). */
export function readGraphTheme(): GraphTheme {
  const c = (token: string): string => resolveColor(`var(${token})`);
  return {
    note: c("--text-2"),
    line: c("--line"),
    paper: c("--paper"),
    text: c("--text"),
    agent: c("--agent"),
    good: c("--good"),
    danger: c("--danger"),
    palette: ["--canvas-1", "--canvas-2", "--canvas-3", "--canvas-4", "--canvas-5", "--canvas-6"].map(c),
  };
}

/** Calls `onChange` when the theme changes (the system setting or the `data-theme` choice). Returns a function that stops listening. */
export function watchTheme(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}
