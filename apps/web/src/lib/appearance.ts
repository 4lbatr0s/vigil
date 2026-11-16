export type Theme = "system" | "light" | "dark";
export type TextSize = "small" | "medium" | "large";
export type Appearance = { theme: Theme; size: TextSize };

export const DEFAULT_APPEARANCE: Appearance = { theme: "system", size: "medium" };
/** The prose font size per choice, in px (medium is the design's 17). */
export const PROSE_PX: Record<TextSize, number> = { small: 16, medium: 17, large: 19 };

const KEY = "vigil.appearance";

/** Reads whatever was stored and keeps only valid values, so a damaged entry never breaks the page. */
export function parseAppearance(raw: string | null): Appearance {
  if (raw === null) return DEFAULT_APPEARANCE;
  try {
    const v = JSON.parse(raw) as Partial<Appearance> | null;
    return {
      theme: v?.theme === "light" || v?.theme === "dark" ? v.theme : "system",
      size: v?.size === "small" || v?.size === "large" ? v.size : "medium",
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function loadAppearance(): Appearance {
  try {
    return parseAppearance(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    // A blocked store only means the choice is not remembered.
  }
}

/** Puts the choice on the page: `data-theme` for an explicit theme (system leaves it to the browser) and the prose size token. */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): void {
  if (a.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", a.theme);
  if (a.size === "medium") root.style.removeProperty("--text-prose");
  else root.style.setProperty("--text-prose", `${PROSE_PX[a.size]}px`);
}
