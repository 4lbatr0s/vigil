import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guardrails for the v3 design system (ADR-0029, docs/design/ui-rules.md).
 * They apply to every `.svelte` file under `src/`. `LEGACY` lists files that still break a rule; it
 * must only shrink. A new file never goes on it: fix the file instead.
 */
const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const LEGACY: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(src).filter((f) => f.endsWith(".svelte") && !LEGACY.includes(path.relative(src, f)));

type Rule = { name: string; test: RegExp };

const RULES: Rule[] = [
  { name: "raw colour: use a token from tokens.css", test: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lch)\(/ },
  { name: "raw border-radius: use --r-control, --r-surface, --r-float or --r-pill", test: /border-radius:\s*[0-9.]+(?:px|rem|em)\b/ },
  { name: "raw font-size or font shorthand: use a --type-* role", test: /font-size:\s*[0-9.]+(?:px|rem)\b/ },
  { name: "raw duration: use --dur-fast, --dur-base or --dur-slow", test: /\b(?!0s\b)[0-9.]+m?s\b(?=\s*(?:;|,|ease|linear|cubic))/ },
  { name: "uppercase text: write sentence case", test: /text-transform:\s*uppercase/ },
  { name: "gradient or glow: not part of the system", test: /(?:linear|radial|conic)-gradient\(|filter:\s*drop-shadow|backdrop-filter/ },
  { name: "left or right accent stripe: not part of the system", test: /border-(?:left|right):\s*[2-9]px/ },
];

/** Primitive class names that only `src/lib/ui/` may define. */
const OWNED_CLASSES = /^\s*\.(?:btn|button|card|field|chip|badge|empty|row|dialog|modal|tab|tabs)\s*[{,.:\s]/;

describe("design system guardrails", () => {
  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const rule of RULES) {
    it(`no ${rule.name}`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (rule.test.test(line)) offenders.push(`${path.relative(src, file)}:${i + 1}: ${line.trim()}`);
          });
      }
      expect(offenders).toEqual([]);
    });
  }

  it("routes do not define primitive classes (.btn, .card, .field, .chip, .empty, .row, ...)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.includes(`${path.sep}lib${path.sep}ui${path.sep}`)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (OWNED_CLASSES.test(line)) offenders.push(`${path.relative(src, file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("every icon-only IconButton usage passes a label", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/<IconButton\b/.test(line) && !/\blabel=/.test(line)) offenders.push(`${path.relative(src, file)}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
