import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const RAW = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

describe("colors come from tokens only", () => {
  it("no .svelte or .ts file under src (except app.css and this test) contains a raw color", () => {
    const offenders: string[] = [];
    for (const file of walk(src)) {
      if (!/\.(svelte|ts)$/.test(file) || file.endsWith("no-raw-colors.test.ts") || file.endsWith("contrast.test.ts")) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (RAW.test(line)) offenders.push(`${path.relative(src, file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
