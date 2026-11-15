#!/usr/bin/env node
// Fails when the JavaScript needed to open "/" (shell, notes list, editor core) is over budget.
// Reads the SvelteKit client build (run `pnpm --filter @vigil/web build` first), follows only
// static imports from the start and app entries and the layout and page nodes of "/", and gzips
// each file. Dynamic imports (code-split chunks such as language support) are not initial.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web");
const client = path.join(root, ".svelte-kit", "output", "client");
const BUDGET_KB = Number(process.env.VIGIL_BUNDLE_BUDGET_KB ?? 180);
// Libraries that belong to routes opened later and must never ride in the first load.
const LAZY_ONLY = ["sigma", "graphology"];

const manifest = JSON.parse(readFileSync(path.join(client, ".vite", "manifest.json"), "utf8"));
const byFile = new Map(Object.entries(manifest).map(([key, value]) => [value.file, key]));

const app = readFileSync(path.join(root, ".svelte-kit", "generated", "client-optimized", "app.js"), "utf8");
const dict = /"\/":\s*\[([0-9,\s]+)\]/.exec(app);
if (!dict) throw new Error('Could not find the "/" route in the generated client app');
const nodeIds = dict[1].split(",").map((s) => Number(s.trim()));

const starts = [];
for (const [key, value] of Object.entries(manifest)) {
  if (value.isEntry && (key.includes("kit") && key.endsWith("start.js") || key.endsWith("client-optimized/app.js"))) starts.push(key);
  if (nodeIds.some((id) => key.endsWith(`client-optimized/nodes/${id}.js`))) starts.push(key);
}

const seen = new Set();
const visit = (key) => {
  if (seen.has(key)) return;
  const entry = manifest[key];
  if (!entry) return;
  seen.add(key);
  for (const dep of entry.imports ?? []) visit(dep);
};
starts.forEach(visit);

let total = 0;
const rows = [];
for (const key of seen) {
  const file = manifest[key].file;
  if (!file.endsWith(".js")) continue;
  const code = readFileSync(path.join(client, file));
  const gz = gzipSync(code).length;
  total += gz;
  rows.push([gz, file]);
  for (const lib of LAZY_ONLY) {
    if (code.includes(lib)) {
      console.error(`FAIL: ${file} is in the first load and mentions "${lib}", which must load lazily`);
      process.exitCode = 1;
    }
  }
}
rows.sort((a, b) => b[0] - a[0]);
for (const [gz, file] of rows.slice(0, 6)) console.log(`${(gz / 1024).toFixed(1).padStart(7)} KB  ${file}`);
const kb = total / 1024;
console.log(`first load of "/": ${kb.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB, ${rows.length} files)`);
if (kb > BUDGET_KB) {
  console.error(`FAIL: over budget by ${(kb - BUDGET_KB).toFixed(1)} KB`);
  process.exitCode = 1;
}
