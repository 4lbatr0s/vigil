import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app.css"), "utf8");

/** Reads `--token: #hex` declarations from the first block whose opening line matches `selector`. */
function tokens(selector: RegExp): Record<string, string> {
  const start = css.search(selector);
  if (start < 0) throw new Error(`no block matches ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    i += 1;
  }
  const out: Record<string, string> = {};
  for (const m of css.slice(open + 1, i).matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1] as string] = (m[2] as string).toLowerCase();
  return out;
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const themes: Array<[string, Record<string, string>]> = [
  ["dark (default)", tokens(/^:root \{/m)],
  ["light (system)", tokens(/prefers-color-scheme: light\)/)],
  ['light (data-theme="light")', tokens(/:root\[data-theme="light"\]/)],
];

describe("design tokens", () => {
  it("defines the light set both for the system setting and as a data-theme override", () => {
    for (const [name, t] of themes) {
      for (const key of ["bg", "surface", "hairline", "ink", "ink-muted", "amber", "ok", "err", "amber-ink", "err-ink"]) expect(t[key], `${name} ${key}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("the two light sets are identical", () => {
    expect(themes[1]?.[1]).toEqual(themes[2]?.[1]);
  });

  for (const [name, t] of themes) {
    it(`text tokens reach 4.5:1 on bg and surface: ${name}`, () => {
      for (const text of ["ink", "ink-muted", "amber-ink", "err-ink", "ok"]) {
        for (const ground of ["bg", "surface"]) {
          const ratio = contrast(t[text] as string, t[ground] as string);
          expect(ratio, `${name}: ${text} on ${ground} is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  // Hover and raised surfaces are mixes of surface and ink, so they shift with the theme: muted text must still read on them.
  const mixShare = (name: string): number => {
    const m = new RegExp(`--${name}:\\s*color-mix\\(in srgb,\\s*var\\(--surface\\)\\s*(\\d+)%,\\s*var\\(--ink\\)\\)`).exec(css);
    if (!m) throw new Error(`--${name} is not a surface and ink mix`);
    return Number(m[1]) / 100;
  };
  const mixHex = (a: string, b: string, shareOfA: number): string =>
    "#" + [1, 3, 5].map((i) => Math.round(shareOfA * parseInt(a.slice(i, i + 2), 16) + (1 - shareOfA) * parseInt(b.slice(i, i + 2), 16)).toString(16).padStart(2, "0")).join("");
  for (const [name, t] of themes) {
    for (const token of ["surface-hover", "surface-raised"]) {
      it(`muted and ink text reach 4.5:1 on ${token}: ${name}`, () => {
        const ground = mixHex(t["surface"] as string, t["ink"] as string, mixShare(token));
        for (const text of ["ink", "ink-muted"]) {
          const ratio = contrast(t[text] as string, ground);
          expect(ratio, `${name}: ${text} on ${token} (${ground}) is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});
