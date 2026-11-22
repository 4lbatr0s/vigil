import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guardrails for the v3 design system (ADR-0029, docs/design/ui-rules.md).
 * They apply to every file under `src/lib/ui/` and to every file listed in MIGRATED. When a screen
 * moves to the new components, add its files to MIGRATED in the same commit; from then on the
 * rules hold there too. Legacy screens are not checked until they are listed.
 */
const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const MIGRATED: string[] = [
  "routes/design/+page.svelte",
  "routes/+page.svelte",
  "routes/today/+page.svelte",
  "routes/study/+page.svelte",
  "routes/agents/+page.svelte",
  "routes/approvals/+page.svelte",
  "routes/settings/+page.svelte",
  "lib/components/ModelsSettings.svelte",
  "lib/components/McpSettings.svelte",
  "lib/components/MeaningSettings.svelte",
  "lib/components/StudySettings.svelte",
  "lib/components/TidyPictures.svelte",
  "lib/components/ConnectionWizard.svelte",
  "lib/components/ChatView.svelte",
  "routes/agents/[name]/+page.svelte",
  "routes/agents/new/+page.svelte",
  "lib/components/ExamDates.svelte",
  "lib/components/Shell.svelte",
  "lib/components/Banner.svelte",
  "lib/components/NoteList.svelte",
  "lib/components/RenameNote.svelte",
  "lib/components/DeleteNote.svelte",
  "lib/components/NoteEditor.svelte",
  "lib/components/Backlinks.svelte",
  "lib/components/RelatedNotes.svelte",
  "lib/components/NoteActivity.svelte",
  "lib/components/ProvenanceBar.svelte",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = [
  ...walk(path.join(src, "lib", "ui")).filter((f) => f.endsWith(".svelte")),
  ...MIGRATED.map((f) => path.join(src, f)),
];

type Rule = { name: string; test: RegExp };

const RULES: Rule[] = [
  { name: "raw colour: use a token from tokens.css", test: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lch)\(/ },
  { name: "raw border-radius: use --r-control, --r-surface, --r-float or --r-pill", test: /border-radius:\s*[0-9.]+(?:px|rem|em|%)/ },
  { name: "raw font-size or font shorthand: use a --type-* role", test: /font-size:\s*[0-9.]+(?:px|rem|em)\b/ },
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
